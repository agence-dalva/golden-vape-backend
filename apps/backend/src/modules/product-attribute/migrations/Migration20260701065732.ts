import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260701065732 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "attribute_type" add column if not exists "allow_multiple" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "attribute_type" drop column if exists "allow_multiple";`);
  }

}
