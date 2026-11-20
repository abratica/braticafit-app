import { askClaudeJson } from "./claude.ts";

export const KEYS = ["kcal", "protein", "carbs", "fat", "sat_fat", "fiber", "soluble_fiber", "sugar", "sodium"] as const;
export type Nutrients = Record<(typeof KEYS)[number], number>;

const zero = (): Nutrients => Object.fromEntries(KEYS.map((k) => [k, 0])) as Nutrients;

type ClaudeItem = {
  name: string;
  portion: string;
  grams: number;
  usda_query: string;
  estimate: Partial<Nutrients>;
  from_label?: boolean;
};
type ClaudeMeal = {
  error?: string;
  name: string;
  items: ClaudeItem[];
  tags?: string[];
  confidence?: string;
  note?: string;
};

const SYSTEM = `You are the food-logging engine of a personal nutrition app.
The user shows you a photo of food they are about to eat, or describes it in words.
Identify each distinct food on the plate and estimate a realistic portion in grams.
Include likely hidden additions (cooking oil, butter, dressing, sauce) as their own items when they are probably there.
For each item give:
- name: plain everyday name
- portion: friendly portion description, e.g. "1 cup", "6 oz", "2 slices"
- grams: estimated edible weight in grams (number)
- usda_query: a short generic search term for the USDA FoodData Central database, e.g. "chicken breast roasted", "white rice cooked", "broccoli cooked"
- estimate: your own per-portion estimate of kcal, protein, carbs, fat, sat_fat, fiber, soluble_fiber, sugar (all grams except kcal) and sodium (mg)
Also return:
- name: a short name for the whole meal, as the user would call it (max 5 words)
- tags: any that apply from ["nut","soy","plant_sterol","soluble_fiber"] (soluble_fiber when the meal contains a meaningful source such as oats, barley, beans, lentils, apples, citrus, psyllium)
- confidence: "high", "medium" or "low"
- note: one short sentence about your main assumption, or ""
If the photo shows a Nutrition Facts label (or any printed nutrition panel), do not estimate: return ONE item for the product,
with portion = the label's serving size, grams = the serving size in grams (estimate from the label if only volume is given),
estimate = the label's exact per-serving numbers (sodium in mg; soluble_fiber only if printed, else 0), usda_query = "", and "from_label": true.
Use the product name if it is visible, otherwise a short description such as "Protein bar".
If the image or text contains no food, reply {"error":"no_food"}.
JSON shape: {"name":"","items":[{"name":"","portion":"","grams":0,"usda_query":"","estimate":{}}],"tags":[],"confidence":"","note":""}`;

// USDA nutrient numbers -> our keys (values per 100 g for Foundation / SR Legacy / FNDDS foods)
const USDA_MAP: Record<string, keyof Nutrients> = {
  "203": "protein",
  "204": "fat",
  "205": "carbs",
  "291": "fiber",
  "269": "sugar",
  "307": "sodium",
  "606": "sat_fat",
};

type UsdaHit = { fdcId: number; description: string; per100: Partial<Nutrients> };

async function usdaLookup(query: string): Promise<UsdaHit | null> {
  const key = Deno.env.get("USDA_API_KEY");
  if (!key || !query) return null;
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", key);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", "5");
  url.searchParams.set("dataType", "Survey (FNDDS),SR Legacy,Foundation");
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const food = (data.foods ?? [])[0];
    if (!food) return null;
    const per100: Partial<Nutrients> = {};
    let kcal208: number | undefined, kcalAtwater: number | undefined;
    for (const n of food.foodNutrients ?? []) {
      const num = String(n.nutrientNumber ?? "");
      const unit = String(n.unitName ?? "").toUpperCase();
      if (num === "208" && unit === "KCAL") kcal208 = n.value;
      else if ((num === "958" || num === "957") && unit === "KCAL") kcalAtwater ??= n.value;
      else if (USDA_MAP[num]) per100[USDA_MAP[num]] = n.value;
    }
    const kcal = kcal208 ?? kcalAtwater;
    if (kcal === undefined) return null;
    per100.kcal = kcal;
    return { fdcId: food.fdcId, description: food.description, per100 };
  } catch {
    return null;
  }
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export type AnalyzedItem = {
  name: string;
  portion: string;
  grams: number;
  nutrients: Nutrients;
  per_gram: Nutrients;
  source: "usda" | "estimate" | "label";
  usda_desc?: string;
};

export async function analyzeMeal(input: { image?: string; mediaType?: string; text?: string }) {
  const content = [];
  if (input.image) {
    content.push({
      type: "image" as const,
      source: { type: "base64" as const, media_type: input.mediaType || "image/jpeg", data: input.image },
    });
  }
  content.push({
    type: "text" as const,
    text: input.text?.trim()
      ? `Here is what I'm eating: ${input.text.trim()}`
      : "Here is a photo of what I'm eating.",
  });

  const meal = await askClaudeJson<ClaudeMeal>(SYSTEM, content, 2000);
  if (meal.error) return { error: meal.error };

  const items: AnalyzedItem[] = await Promise.all(
    (meal.items ?? []).map(async (it) => {
      const grams = Math.max(1, Number(it.grams) || 100);
      const est = zero();
      for (const k of KEYS) est[k] = Number(it.estimate?.[k]) || 0;

      const fromLabel = it.from_label === true;
      const hit = fromLabel ? null : await usdaLookup(it.usda_query || it.name);
      let nutrients = est;
      let source: "usda" | "estimate" | "label" = fromLabel ? "label" : "estimate";
      if (hit) {
        const fromUsda = zero();
        for (const k of KEYS) {
          const v = hit.per100[k];
          fromUsda[k] = v === undefined ? est[k] : (v * grams) / 100;
        }
        fromUsda.soluble_fiber = est.soluble_fiber; // USDA rarely reports soluble fiber
        // Guard against a bad database match: keep the estimate if calories disagree wildly.
        const ratio = est.kcal > 30 ? fromUsda.kcal / est.kcal : 1;
        if (ratio >= 0.4 && ratio <= 2.5) {
          nutrients = fromUsda;
          source = "usda";
        }
      }
      const per_gram = zero();
      for (const k of KEYS) {
        per_gram[k] = nutrients[k] / grams;
        nutrients[k] = round(nutrients[k], k === "kcal" || k === "sodium" ? 0 : 1);
      }
      return {
        name: it.name,
        portion: it.portion,
        grams: Math.round(grams),
        nutrients,
        per_gram,
        source,
        usda_desc: source === "usda" ? hit?.description : undefined,
      };
    }),
  );

  const total = zero();
  for (const it of items) for (const k of KEYS) total[k] += it.nutrients[k];
  for (const k of KEYS) total[k] = round(total[k], k === "kcal" || k === "sodium" ? 0 : 1);

  const tags = (meal.tags ?? []).filter((t) => ["nut", "soy", "plant_sterol", "soluble_fiber"].includes(t));
  return {
    name: meal.name || items.map((i) => i.name).join(", "),
    items,
    nutrients: total,
    tags,
    confidence: meal.confidence ?? "medium",
    note: meal.note ?? "",
  };
}


// ---------------------------------------------------------------------------
// Search-as-you-type against USDA FoodData Central (generic + branded foods)
// ---------------------------------------------------------------------------
export type SearchHit = {
  id: string;                 // "usda:123" or "fs:456"
  name: string;
  brand: string | null;
  kind: "generic" | "branded";
  per100: Nutrients;          // per 100 g, or per one serving when perServingOnly
  servings: { label: string; grams: number }[];
  perServingOnly?: boolean;   // no gram weight known: amounts are counted in servings
};

function per100From(food: any): Nutrients | null {
  const out = zero();
  let kcal208: number | undefined, kcalAtwater: number | undefined, kj: number | undefined;
  for (const n of food.foodNutrients ?? []) {
    const num = String(n.nutrientNumber ?? "");
    const unit = String(n.unitName ?? "").toUpperCase();
    const v = Number(n.value);
    if (!Number.isFinite(v)) continue;
    if (num === "208" && unit === "KCAL") kcal208 = v;
    else if (num === "268" && unit === "KJ") kj = v;
    else if ((num === "958" || num === "957") && unit === "KCAL") kcalAtwater ??= v;
    else if (USDA_MAP[num]) out[USDA_MAP[num]] = v;
  }
  const kcal = kcal208 ?? kcalAtwater ?? (kj !== undefined ? kj / 4.184 : undefined);
  if (kcal === undefined) return null;
  out.kcal = kcal;
  return out;
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s,(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

export async function searchUsda(q: string): Promise<SearchHit[]> {
  const key = Deno.env.get("USDA_API_KEY") || "DEMO_KEY";
  const run = async (dataType: string, pageSize: number) => {
    const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
    url.searchParams.set("api_key", key);
    url.searchParams.set("query", q);
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("dataType", dataType);
    const res = await fetch(url);
    if (res.status === 429) throw new Error("rate_limited");
    if (!res.ok) throw new Error(`USDA search failed (${res.status})`);
    return (await res.json()).foods ?? [];
  };
  const [generic, branded] = await Promise.all([
    run("Survey (FNDDS),Foundation,SR Legacy", 12),
    run("Branded", 15),
  ]);
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const f of [...generic, ...branded]) {
    const per100 = per100From(f);
    if (!per100) continue;
    const isBranded = f.dataType === "Branded";
    const brand = isBranded ? titleCase(String(f.brandName || f.brandOwner || "")) || null : null;
    const name = titleCase(String(f.description || "").trim());
    const dedupe = `${name}|${brand ?? ""}`.toLowerCase();
    if (!name || seen.has(dedupe)) continue;
    seen.add(dedupe);
    const servings: { label: string; grams: number }[] = [];
    if (isBranded && Number(f.servingSize) > 0 && /^(g|grm|ml|mlt)$/i.test(String(f.servingSizeUnit || ""))) {
      const g = Number(f.servingSize);
      const house = String(f.householdServingFullText || "").trim();
      servings.push({ label: house ? `${house} (${round(g, 0)} g)` : `1 serving (${round(g, 0)} g)`, grams: g });
    }
    for (const m of f.foodMeasures ?? []) {
      const g = Number(m.gramWeight);
      const label = String(m.disseminationText || "").trim();
      if (g > 0 && label && !/quantity not specified/i.test(label) && servings.length < 6) {
        servings.push({ label: `${label} (${round(g, 0)} g)`, grams: g });
      }
    }
    hits.push({ id: `usda:${f.fdcId}`, name, brand, kind: isBranded ? "branded" : "generic", per100, servings });
  }
  return hits.slice(0, 25);
}


// ---------------------------------------------------------------------------
// fatsecret: branded, supermarket and restaurant foods. Tried first; USDA is the fallback.
// ---------------------------------------------------------------------------
let fsToken: { value: string; until: number } | null = null;

export function fatsecretConfigured() {
  return !!(Deno.env.get("FATSECRET_CLIENT_ID") && Deno.env.get("FATSECRET_CLIENT_SECRET"));
}

async function fatsecretToken(): Promise<string> {
  if (fsToken && fsToken.until > Date.now() + 60_000) return fsToken.value;
  const id = Deno.env.get("FATSECRET_CLIENT_ID")!, secret = Deno.env.get("FATSECRET_CLIENT_SECRET")!;
  const res = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",   // no scope: fatsecret grants every scope this key has
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`fatsecret token: ${data.error_description || data.error || res.status}`);
  fsToken = { value: data.access_token, until: Date.now() + Number(data.expires_in ?? 3600) * 1000 };
  return fsToken.value;
}

async function fsGet(path: string, params: Record<string, string>) {
  const url = new URL(`https://platform.fatsecret.com/rest/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "json");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await fatsecretToken()}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`fatsecret ${path}: ${data.error?.message || res.status}`);
  return data;
}

const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// One fatsecret serving -> our nutrients for that serving.
function fsServingNutrients(sv: any): Nutrients {
  const n = zero();
  n.kcal = num(sv.calories); n.protein = num(sv.protein); n.carbs = num(sv.carbohydrate); n.fat = num(sv.fat);
  n.sat_fat = num(sv.saturated_fat); n.fiber = num(sv.fiber); n.sugar = num(sv.sugar); n.sodium = num(sv.sodium);
  return n;
}

function fsHit(f: any): SearchHit | null {
  const svs = arr(f.servings?.serving);
  if (!svs.length) return null;
  const isBranded = String(f.food_type || "").toLowerCase() === "brand";
  const name = String(f.food_name || "").trim();
  const brand = isBranded ? String(f.brand_name || "").trim() || null : null;
  const metric = svs.filter((sv) => /^(g|ml)$/i.test(String(sv.metric_serving_unit || "")) && num(sv.metric_serving_amount) > 0);
  const kind = isBranded ? "branded" : "generic";
  if (metric.length) {
    // Base the per-100 g numbers on the default serving when it has a gram weight.
    const base = metric.find((sv) => String(sv.is_default) === "1") ?? metric[0];
    const g = num(base.metric_serving_amount);
    const per = fsServingNutrients(base);
    const per100 = Object.fromEntries(KEYS.map((k) => [k, (per[k] * 100) / g])) as Nutrients;
    const servings = metric
      .filter((sv) => !/^100\s*g$/i.test(String(sv.serving_description || "").trim()))
      .slice(0, 6)
      .map((sv) => ({ label: `${String(sv.serving_description).trim()} (${round(num(sv.metric_serving_amount), 0)} g)`, grams: num(sv.metric_serving_amount) }));
    return { id: `fs:${f.food_id}`, name, brand, kind, per100, servings };
  }
  const sv = svs.find((x) => String(x.is_default) === "1") ?? svs[0];
  return { id: `fs:${f.food_id}`, name, brand, kind, per100: fsServingNutrients(sv), servings: [{ label: String(sv.serving_description || "1 serving").trim(), grams: 100 }], perServingOnly: true };
}

// Basic keys only get a text summary per food ("Per 1 burger - Calories: 590kcal | Fat: 34.00g | ...").
function fsHitFromDescription(f: any): SearchHit | null {
  const d = String(f.food_description || "");
  const m = d.match(/^Per\s+(.+?)\s+-\s+Calories:\s*([\d.]+)kcal\s*\|\s*Fat:\s*([\d.]+)g\s*\|\s*Carbs:\s*([\d.]+)g\s*\|\s*Protein:\s*([\d.]+)g/i);
  if (!m) return null;
  const isBranded = String(f.food_type || "").toLowerCase() === "brand";
  const n = zero();
  n.kcal = num(m[2]); n.fat = num(m[3]); n.carbs = num(m[4]); n.protein = num(m[5]);
  const unit = m[1].trim();
  const grams = unit.match(/^([\d.]+)\s*g$/i);
  const base = { id: `fs:${f.food_id}`, name: String(f.food_name || "").trim(), brand: isBranded ? String(f.brand_name || "").trim() || null : null, kind: (isBranded ? "branded" : "generic") as "branded" | "generic" };
  if (grams) {
    const g = num(grams[1]);
    const per100 = Object.fromEntries(KEYS.map((k) => [k, (n[k] * 100) / g])) as Nutrients;
    return { ...base, per100, servings: g === 100 ? [] : [{ label: `${unit}`, grams: g }] };
  }
  return { ...base, per100: n, servings: [{ label: unit, grams: 100 }], perServingOnly: true };
}

export async function searchFatsecret(q: string): Promise<SearchHit[]> {
  try {
    // Premier keys: full servings with gram weights.
    const data = await fsGet("foods/search/v3", { search_expression: q, max_results: "25", page_number: "0" });
    const foods = arr(data.foods_search?.results?.food);
    return foods.map(fsHit).filter(Boolean) as SearchHit[];
  } catch (e) {
    if (!/v3/.test((e as Error).message)) throw e;
    // Basic keys: the original search with a one-line nutrition summary.
    const data = await fsGet("foods/search/v1", { search_expression: q, max_results: "25", page_number: "0" });
    return arr(data.foods?.food).map(fsHitFromDescription).filter(Boolean) as SearchHit[];
  }
}
