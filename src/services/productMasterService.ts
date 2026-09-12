import { supabase } from "@/lib/supabase";
import { Database } from "@/types/database.types";
export type ProductMasterRow = Database["public"]["Tables"]["products"]["Row"];
export type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
export type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];
const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
export const productMasterService = {
  async getProducts() { const { data, error } = await supabase.from("products").select("*").order("sort_order").order("name").order("category_sort_order").order("category").order("variant_sort_order").order("created_at"); fail(error); return data ?? []; },
  async getProductById(id: string) { const { data, error } = await supabase.from("products").select("*").eq("id", id).maybeSingle(); fail(error); return data; },
  async createProduct(product: ProductInsert) { const { data, error } = await supabase.from("products").insert(product).select().single(); fail(error); return data!; },
  async updateProduct(id: string, updates: ProductUpdate) { const { data, error } = await supabase.from("products").update(updates).eq("id", id).select().single(); fail(error); return data!; },
  async deleteProduct(id: string) { const { error } = await supabase.from("products").delete().eq("id", id); fail(error); },
  async updateServiceOrder(name: string, sortOrder: number) { const { error } = await supabase.from("products").update({ sort_order: sortOrder }).eq("name", name); fail(error); },
  async updateCategoryOrder(name: string, category: string, sortOrder: number) { const { error } = await supabase.from("products").update({ category_sort_order: sortOrder }).eq("name", name).eq("category", category); fail(error); },
  async updateVariantOrder(id: string, sortOrder: number) { const { error } = await supabase.from("products").update({ variant_sort_order: sortOrder }).eq("id", id); fail(error); },
  async reorderServices(items: Array<{ name: string; sortOrder: number }>) { for (const item of items) await this.updateServiceOrder(item.name, item.sortOrder); },
  async reorderCategories(serviceName: string, items: Array<{ category: string; sortOrder: number }>) { for (const item of items) await this.updateCategoryOrder(serviceName, item.category, item.sortOrder); },
  async reorderVariants(items: Array<{ id: string; sortOrder: number }>) { for (const item of items) await this.updateVariantOrder(item.id, item.sortOrder); },
  async deleteService(name: string) { const { error } = await supabase.from("products").delete().eq("name", name); fail(error); },
  async deleteCategory(name: string, category: string) { const { error } = await supabase.from("products").delete().eq("name", name).eq("category", category); fail(error); },
  async updateServiceImage(name: string, imageUrl: string | null, imagePublicId: string | null) {
    const { error } = await supabase
      .from("products")
      .update({ image_url: imageUrl, image_public_id: imagePublicId })
      .eq("name", name);
    fail(error);
  },
  subscribe(onChange: () => void) { const channel = supabase.channel("products-admin").on("postgres_changes", { event: "*", schema: "public", table: "products" }, onChange).subscribe(); return () => { void supabase.removeChannel(channel); }; }
};
