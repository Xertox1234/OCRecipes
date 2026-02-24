/**
 * Cultural food name mapping for improved recognition accuracy.
 * Maps regional/cultural food names to standardized nutrition lookup terms.
 */

interface CulturalFoodEntry {
  standardName: string;
  aliases: string[];
  cuisine: string;
  typicalServing: string;
  category:
    | "protein"
    | "vegetable"
    | "grain"
    | "fruit"
    | "dairy"
    | "beverage"
    | "other";
}

// Comprehensive mapping of cultural food names
const CULTURAL_FOOD_MAP: CulturalFoodEntry[] = [
  // South Asian
  {
    standardName: "lentil curry",
    aliases: ["dal", "daal", "dhal", "toor dal", "masoor dal", "chana dal"],
    cuisine: "South Asian",
    typicalServing: "1 cup",
    category: "protein",
  },
  {
    standardName: "flatbread",
    aliases: ["naan", "roti", "chapati", "paratha", "kulcha", "puri"],
    cuisine: "South Asian",
    typicalServing: "1 piece",
    category: "grain",
  },
  {
    standardName: "rice pilaf",
    aliases: ["biryani", "pulao", "pilau", "khichdi"],
    cuisine: "South Asian",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "yogurt drink",
    aliases: ["lassi", "chaas", "buttermilk"],
    cuisine: "South Asian",
    typicalServing: "1 cup",
    category: "dairy",
  },
  {
    standardName: "deep fried pastry with filling",
    aliases: ["samosa", "singara"],
    cuisine: "South Asian",
    typicalServing: "2 pieces",
    category: "grain",
  },
  {
    standardName: "tandoori chicken",
    aliases: ["tandoori murgh", "chicken tikka"],
    cuisine: "South Asian",
    typicalServing: "2 pieces",
    category: "protein",
  },
  {
    standardName: "paneer curry",
    aliases: ["palak paneer", "shahi paneer", "matar paneer", "paneer tikka"],
    cuisine: "South Asian",
    typicalServing: "1 cup",
    category: "protein",
  },
  {
    standardName: "chickpea curry",
    aliases: ["chana masala", "chole", "chole bhature"],
    cuisine: "South Asian",
    typicalServing: "1 cup",
    category: "protein",
  },

  // East Asian
  {
    standardName: "soy sauce noodle soup",
    aliases: ["ramen", "ra-men"],
    cuisine: "Japanese",
    typicalServing: "1 bowl",
    category: "grain",
  },
  {
    standardName: "sushi rice roll",
    aliases: ["sushi", "maki", "nigiri", "temaki"],
    cuisine: "Japanese",
    typicalServing: "8 pieces",
    category: "grain",
  },
  {
    standardName: "soybean paste soup",
    aliases: ["miso soup", "miso shiru"],
    cuisine: "Japanese",
    typicalServing: "1 cup",
    category: "other",
  },
  {
    standardName: "deep fried battered food",
    aliases: ["tempura"],
    cuisine: "Japanese",
    typicalServing: "5 pieces",
    category: "other",
  },
  {
    standardName: "rice bowl with topping",
    aliases: ["donburi", "gyudon", "katsudon", "oyakodon"],
    cuisine: "Japanese",
    typicalServing: "1 bowl",
    category: "grain",
  },
  {
    standardName: "steamed dumplings",
    aliases: [
      "dim sum",
      "siu mai",
      "har gow",
      "gyoza",
      "jiaozi",
      "mandu",
      "momo",
    ],
    cuisine: "East Asian",
    typicalServing: "6 pieces",
    category: "grain",
  },
  {
    standardName: "stir fried noodles",
    aliases: ["lo mein", "chow mein", "pad see ew", "yakisoba", "japchae"],
    cuisine: "East Asian",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "fried rice",
    aliases: ["chao fan", "nasi goreng", "kimchi fried rice", "yang chow"],
    cuisine: "East Asian",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "spring roll",
    aliases: ["egg roll", "lumpia", "nem ran", "popiah"],
    cuisine: "East Asian",
    typicalServing: "2 pieces",
    category: "grain",
  },
  {
    standardName: "fermented cabbage",
    aliases: ["kimchi", "kimchee"],
    cuisine: "Korean",
    typicalServing: "0.5 cup",
    category: "vegetable",
  },
  {
    standardName: "Korean BBQ beef",
    aliases: ["bulgogi", "galbi", "kalbi"],
    cuisine: "Korean",
    typicalServing: "4 oz",
    category: "protein",
  },
  {
    standardName: "rice cake",
    aliases: ["tteokbokki", "tteok", "mochi", "nian gao"],
    cuisine: "East Asian",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "fermented soybean",
    aliases: ["natto", "doenjang", "tempeh"],
    cuisine: "East Asian",
    typicalServing: "0.5 cup",
    category: "protein",
  },
  {
    standardName: "tofu",
    aliases: ["doufu", "tahu", "bean curd"],
    cuisine: "East Asian",
    typicalServing: "4 oz",
    category: "protein",
  },

  // Southeast Asian
  {
    standardName: "coconut curry soup",
    aliases: ["tom kha", "laksa", "curry laksa"],
    cuisine: "Southeast Asian",
    typicalServing: "1 bowl",
    category: "other",
  },
  {
    standardName: "spicy soup",
    aliases: ["tom yum", "sinigang", "soto ayam"],
    cuisine: "Southeast Asian",
    typicalServing: "1 bowl",
    category: "other",
  },
  {
    standardName: "stir fried rice noodles",
    aliases: ["pad thai", "pho xao", "char kway teow"],
    cuisine: "Southeast Asian",
    typicalServing: "1 plate",
    category: "grain",
  },
  {
    standardName: "Vietnamese soup with rice noodles",
    aliases: ["pho", "bun bo hue"],
    cuisine: "Vietnamese",
    typicalServing: "1 bowl",
    category: "grain",
  },
  {
    standardName: "fresh spring roll",
    aliases: ["goi cuon", "summer roll", "rice paper roll"],
    cuisine: "Vietnamese",
    typicalServing: "2 pieces",
    category: "grain",
  },
  {
    standardName: "Vietnamese baguette sandwich",
    aliases: ["banh mi"],
    cuisine: "Vietnamese",
    typicalServing: "1 sandwich",
    category: "grain",
  },
  {
    standardName: "coconut rice",
    aliases: ["nasi lemak", "nasi uduk"],
    cuisine: "Southeast Asian",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "satay",
    aliases: ["sate", "satay chicken", "satay beef"],
    cuisine: "Southeast Asian",
    typicalServing: "4 skewers",
    category: "protein",
  },

  // Middle Eastern / Mediterranean
  {
    standardName: "chickpea dip",
    aliases: ["hummus", "houmous", "hommos"],
    cuisine: "Middle Eastern",
    typicalServing: "0.25 cup",
    category: "protein",
  },
  {
    standardName: "eggplant dip",
    aliases: ["baba ganoush", "baba ghanouj", "mutabal"],
    cuisine: "Middle Eastern",
    typicalServing: "0.25 cup",
    category: "vegetable",
  },
  {
    standardName: "meat in pita wrap",
    aliases: ["shawarma", "doner", "gyro", "kebab wrap"],
    cuisine: "Middle Eastern",
    typicalServing: "1 wrap",
    category: "protein",
  },
  {
    standardName: "deep fried chickpea ball",
    aliases: ["falafel"],
    cuisine: "Middle Eastern",
    typicalServing: "4 pieces",
    category: "protein",
  },
  {
    standardName: "bulgur wheat salad",
    aliases: ["tabbouleh", "tabouleh", "kisir"],
    cuisine: "Middle Eastern",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "stuffed grape leaves",
    aliases: ["dolma", "dolmades", "sarma", "warak enab"],
    cuisine: "Middle Eastern",
    typicalServing: "6 pieces",
    category: "grain",
  },
  {
    standardName: "rice pilaf with spices",
    aliases: ["mansaf", "kabsa", "mandi"],
    cuisine: "Middle Eastern",
    typicalServing: "1 cup",
    category: "grain",
  },

  // Latin American
  {
    standardName: "corn tortilla with filling",
    aliases: ["taco", "taquito"],
    cuisine: "Mexican",
    typicalServing: "2 tacos",
    category: "grain",
  },
  {
    standardName: "stuffed tortilla",
    aliases: ["burrito", "enchilada", "chimichanga"],
    cuisine: "Mexican",
    typicalServing: "1 burrito",
    category: "grain",
  },
  {
    standardName: "refried beans",
    aliases: ["frijoles refritos", "frijoles"],
    cuisine: "Mexican",
    typicalServing: "0.5 cup",
    category: "protein",
  },
  {
    standardName: "avocado dip",
    aliases: ["guacamole"],
    cuisine: "Mexican",
    typicalServing: "0.25 cup",
    category: "vegetable",
  },
  {
    standardName: "corn masa dumpling",
    aliases: ["tamale", "tamal", "humita"],
    cuisine: "Latin American",
    typicalServing: "2 pieces",
    category: "grain",
  },
  {
    standardName: "fried plantain",
    aliases: ["tostones", "maduros", "platano frito"],
    cuisine: "Latin American",
    typicalServing: "1 cup",
    category: "vegetable",
  },
  {
    standardName: "rice and beans",
    aliases: [
      "arroz con frijoles",
      "gallo pinto",
      "moros y cristianos",
      "congri",
    ],
    cuisine: "Latin American",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "raw fish in citrus",
    aliases: ["ceviche", "cebiche"],
    cuisine: "Latin American",
    typicalServing: "1 cup",
    category: "protein",
  },
  {
    standardName: "stewed meat",
    aliases: ["ropa vieja", "carne guisada", "feijoada"],
    cuisine: "Latin American",
    typicalServing: "1 cup",
    category: "protein",
  },
  {
    standardName: "empanada",
    aliases: ["empanada", "pastel", "salteña"],
    cuisine: "Latin American",
    typicalServing: "2 pieces",
    category: "grain",
  },

  // African
  {
    standardName: "stewed vegetables with meat",
    aliases: ["tagine", "tajine"],
    cuisine: "North African",
    typicalServing: "1 cup",
    category: "other",
  },
  {
    standardName: "semolina grain",
    aliases: ["couscous", "cous cous"],
    cuisine: "North African",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "spicy stew",
    aliases: ["doro wot", "wot", "wat", "tsebhi"],
    cuisine: "Ethiopian",
    typicalServing: "1 cup",
    category: "other",
  },
  {
    standardName: "fermented flatbread",
    aliases: ["injera", "kisra", "lahoh"],
    cuisine: "Ethiopian",
    typicalServing: "2 pieces",
    category: "grain",
  },
  {
    standardName: "groundnut stew",
    aliases: ["maafe", "domoda", "groundnut soup"],
    cuisine: "West African",
    typicalServing: "1 cup",
    category: "other",
  },
  {
    standardName: "fried bean cake",
    aliases: ["akara", "kosai", "bean fritters"],
    cuisine: "West African",
    typicalServing: "4 pieces",
    category: "protein",
  },
  {
    standardName: "cassava porridge",
    aliases: [
      "fufu",
      "foufou",
      "ugali",
      "banku",
      "kenkey",
      "sadza",
      "nsima",
      "pap",
    ],
    cuisine: "African",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "okra stew",
    aliases: ["okro soup", "okra soup", "bamya"],
    cuisine: "African",
    typicalServing: "1 cup",
    category: "vegetable",
  },
  {
    standardName: "spiced rice",
    aliases: ["jollof rice", "jollof", "thieboudienne"],
    cuisine: "West African",
    typicalServing: "1 cup",
    category: "grain",
  },

  // European
  {
    standardName: "potato dumpling",
    aliases: ["pierogi", "varenyky", "knodel", "gnocchi", "kluski"],
    cuisine: "Eastern European",
    typicalServing: "6 pieces",
    category: "grain",
  },
  {
    standardName: "stuffed cabbage roll",
    aliases: ["golabki", "golubtsy", "sarma", "holubtsi"],
    cuisine: "Eastern European",
    typicalServing: "2 pieces",
    category: "other",
  },
  {
    standardName: "beet soup",
    aliases: ["borscht", "borsch"],
    cuisine: "Eastern European",
    typicalServing: "1 bowl",
    category: "vegetable",
  },
  {
    standardName: "thin pancake with filling",
    aliases: ["crepe", "blini", "palacinky", "palatschinken"],
    cuisine: "European",
    typicalServing: "2 pieces",
    category: "grain",
  },
  {
    standardName: "cured pork sausage",
    aliases: ["kielbasa", "bratwurst", "chorizo", "salami", "saucisson"],
    cuisine: "European",
    typicalServing: "3 oz",
    category: "protein",
  },
  {
    standardName: "layered pasta casserole",
    aliases: ["lasagna", "moussaka", "pastitsio"],
    cuisine: "European",
    typicalServing: "1 piece",
    category: "grain",
  },
  {
    standardName: "risotto",
    aliases: ["risotto", "rice pilaf italian"],
    cuisine: "Italian",
    typicalServing: "1 cup",
    category: "grain",
  },
  {
    standardName: "spanish rice dish with seafood",
    aliases: ["paella"],
    cuisine: "Spanish",
    typicalServing: "1.5 cups",
    category: "grain",
  },
];

/**
 * Look up a food name against cultural food mapping.
 * Returns the standardized entry if a match is found.
 */
export function lookupCulturalFood(
  query: string,
): CulturalFoodEntry | undefined {
  const normalized = query.toLowerCase().trim();
  return CULTURAL_FOOD_MAP.find(
    (entry) =>
      entry.standardName === normalized ||
      entry.aliases.some((alias) => normalized.includes(alias)),
  );
}

/**
 * Get the standardized nutrition lookup name for a cultural food.
 * Falls back to the original query if no mapping exists.
 */
export function getStandardizedFoodName(query: string): string {
  const entry = lookupCulturalFood(query);
  return entry ? entry.standardName : query;
}

/**
 * Get cuisine classification for a food item.
 */
export function getCuisineForFood(foodName: string): string | undefined {
  const entry = lookupCulturalFood(foodName);
  return entry?.cuisine;
}

/**
 * Get typical serving size for a cultural food.
 */
export function getTypicalServing(foodName: string): string | undefined {
  const entry = lookupCulturalFood(foodName);
  return entry?.typicalServing;
}

/**
 * Get all supported cuisines for display.
 */
export function getSupportedCuisines(): string[] {
  const cuisines = new Set(CULTURAL_FOOD_MAP.map((e) => e.cuisine));
  return Array.from(cuisines).sort();
}

export { CULTURAL_FOOD_MAP, type CulturalFoodEntry };
