import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261009053726 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "alerte_stock" drop constraint if exists "alerte_stock_email_variant_id_unique";`);
    this.addSql(`create table if not exists "alerte_stock" ("id" text not null, "email" text not null, "variant_id" text not null, "notified_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "alerte_stock_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_alerte_stock_deleted_at" ON "alerte_stock" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_alerte_stock_email_variant_id_unique" ON "alerte_stock" ("email", "variant_id") WHERE notified_at IS NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_alerte_stock_variant_id" ON "alerte_stock" ("variant_id") WHERE notified_at IS NULL AND deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "alerte_stock" cascade;`);
  }

}
