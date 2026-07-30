import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260715000000 extends Migration {

  // Convertit "preset_values" de text (comma-separated, ex: "Geek Vape,Lost Vape") vers jsonb
  // (array, ex: ["Geek Vape","Lost Vape"]). Entre le 2026-07-01 et le 2026-07-08, la colonne a été
  // créée en text et le code (commit 33eb9b3) sérialisait/désérialisait manuellement en CSV ; le
  // commit 72ffe8d est ensuite repassé au modèle jsonb natif sans jamais migrer les données ni la
  // colonne — cette migration comble cet écart sans perte des valeurs déjà saisies.
  override async up(): Promise<void> {
    // Postgres refuse ALTER TYPE tant qu'un default existant (ici '', string vide) n'est pas
    // castable vers le nouveau type — il faut le retirer avant le changement de type, puis
    // poser le nouveau default jsonb après coup.
    this.addSql(`alter table if exists "attribute_type" alter column "preset_values" drop default;`);
    this.addSql(`
      alter table if exists "attribute_type"
      alter column "preset_values" type jsonb
      using (
        case
          when "preset_values" is null or "preset_values" = '' then '[]'::jsonb
          else to_jsonb(string_to_array("preset_values", ','))
        end
      );
    `);
    this.addSql(`alter table if exists "attribute_type" alter column "preset_values" set default '[]'::jsonb;`);
  }

  override async down(): Promise<void> {
    // Postgres interdit toute sous-requête dans la clause USING d'un ALTER TYPE — le cast direct
    // vers text donnerait le JSON brut (ex: ["A","B"]) plutôt que le CSV d'origine (A,B). On fait
    // donc le changement de type sans transformation, puis un UPDATE séparé (qui autorise les
    // sous-requêtes) pour reconstruire le format CSV via string_agg.
    this.addSql(`alter table if exists "attribute_type" alter column "preset_values" drop default;`);
    this.addSql(`alter table if exists "attribute_type" alter column "preset_values" type text using preset_values::text;`);
    this.addSql(`
      update "attribute_type"
      set "preset_values" = coalesce(
        (select string_agg(elem, ',') from jsonb_array_elements_text("preset_values"::jsonb) as elem),
        ''
      );
    `);
    this.addSql(`alter table if exists "attribute_type" alter column "preset_values" set default '';`);
  }

}
