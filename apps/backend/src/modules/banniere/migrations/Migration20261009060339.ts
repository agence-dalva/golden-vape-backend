import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261009060339 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "image_banniere" ("id" text not null, "url" text not null, "fichier_id" text not null, "largeur" integer not null, "hauteur" integer not null, "rang" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "image_banniere_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_image_banniere_deleted_at" ON "image_banniere" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "image_banniere" cascade;`);
  }

}
