// Input validation and plain helpers. No database imports, so the offline
// (in-browser / iPhone) build can use them without pulling in the ORM.
import { z } from "zod";

export const seedingModeEnum = z.enum(["sequential", "ranked", "random"]);
export type SeedingMode = z.infer<typeof seedingModeEnum>;

export const ageCategoryEnum = z.enum(["youth", "subjuniors", "juniors", "seniors", "masters"]);
export type AgeCategory = z.infer<typeof ageCategoryEnum>;

export const handEnum = z.enum(["left", "right"]);
export type Hand = z.infer<typeof handEnum>;

export const genderEnum = z.enum(["boys", "girls", "men", "women"]);
export type Gender = z.infer<typeof genderEnum>;

export const weightClassSchema = z.object({
  name: z.string().min(1),
  ageCategory: ageCategoryEnum,
  hand: handEnum,
  gender: genderEnum,
});
export type WeightClass = z.infer<typeof weightClassSchema>;

export function weightClassLabel(wc: WeightClass): string {
  const ageCatDisplay: Record<AgeCategory, string> = {
    youth: "Youth",
    juniors: "Juniors",
    subjuniors: "Sub-Juniors",
    seniors: "Seniors",
    masters: "Masters",
  };
  const genderDisplayMap: Record<string, string> = { boys: "Boys", girls: "Girls", men: "Men", women: "Women" };
  const genderDisplay = genderDisplayMap[wc.gender] || wc.gender;
  return `${wc.name} - ${ageCatDisplay[wc.ageCategory]} - ${genderDisplay} - ${wc.hand === "left" ? "Left" : "Right"} Hand`;
}

export const insertTournamentSchema = z.object({
  name: z.string(),
  size: z.number().int(),
  weightCategories: z.array(z.string()).optional().default([]),
  weightClasses: z.array(weightClassSchema).optional().default([]),
  email: z.union([z.string().email(), z.literal("")]).optional().default(""),
});
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
