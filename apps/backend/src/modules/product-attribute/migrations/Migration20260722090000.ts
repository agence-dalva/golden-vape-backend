import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260722090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "attribute_value_image" ("id" text not null, "value" text not null, "image_url" text null, "image_file_id" text null, "attribute_type_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "attribute_value_image_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_attribute_value_image_attribute_type_id" ON "attribute_value_image" ("attribute_type_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_attribute_value_image_deleted_at" ON "attribute_value_image" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_attribute_value_image_attribute_type_id_value_unique" ON "attribute_value_image" ("attribute_type_id", "value") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "attribute_value_image" add constraint "attribute_value_image_attribute_type_id_foreign" foreign key ("attribute_type_id") references "attribute_type" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "attribute_value_image" drop constraint if exists "attribute_value_image_attribute_type_id_foreign";`);

    this.addSql(`drop table if exists "attribute_value_image" cascade;`);
  }

}
