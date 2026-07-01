import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260701063005 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "attribute_type" ("id" text not null, "name" text not null, "preset_values" text not null default '', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "attribute_type_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_attribute_type_deleted_at" ON "attribute_type" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "product_attribute_value" ("id" text not null, "product_id" text not null, "value" text not null, "attribute_type_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_attribute_value_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_attribute_value_attribute_type_id" ON "product_attribute_value" ("attribute_type_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_attribute_value_deleted_at" ON "product_attribute_value" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "product_attribute_value" add constraint "product_attribute_value_attribute_type_id_foreign" foreign key ("attribute_type_id") references "attribute_type" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "product_attribute_value" drop constraint if exists "product_attribute_value_attribute_type_id_foreign";`);

    this.addSql(`drop table if exists "attribute_type" cascade;`);

    this.addSql(`drop table if exists "product_attribute_value" cascade;`);
  }

}
