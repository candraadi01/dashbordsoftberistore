"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronRight, ImagePlus, Layers3, LayoutGrid, List, Package, Pencil, Percent, Plus, Save, Search, Settings2, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { productMasterService, ProductMasterRow } from "@/services/productMasterService";
import { authService } from "@/services/authService";
import { supabase } from "@/lib/supabase";
import { formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type FormState = {
  name: string;
  category: string;
  duration: string;
  price: string;
  profit: string;
  status: "ACTIVE" | "INACTIVE";
  image_url: string;
  image_public_id: string;
};
type CategoryGroup = { name: string; order: number; position: number; variants: ProductMasterRow[] };
type ServiceGroup = { name: string; order: number; position: number; imageUrl: string | null; variants: ProductMasterRow[]; categories: CategoryGroup[] };
type FormMode = "catalog" | "category" | "variant" | "edit";
type ViewMode = "list" | "grid";
type DeleteRequest = { title: string; description: string; action: () => Promise<void> };

const emptyForm: FormState = {
  name: "", category: "", duration: "1 bulan", price: "", profit: "", status: "ACTIVE", image_url: "", image_public_id: "",
};

function buildGroups(products: ProductMasterRow[]): ServiceGroup[] {
  const services = new Map<string, ProductMasterRow[]>();
  products.forEach((product) => services.set(product.name, [...(services.get(product.name) ?? []), product]));

  const sortedServices = [...services.entries()].map(([name, variants]) => {
    const categories = new Map<string, ProductMasterRow[]>();
    variants.forEach((variant) => categories.set(variant.category, [...(categories.get(variant.category) ?? []), variant]));
    const groupedCategories = [...categories.entries()].map(([category, rows]) => ({
      name: category,
      order: Math.min(...rows.map((row) => row.category_sort_order)),
      position: 0,
      variants: [...rows].sort((a, b) => a.variant_sort_order - b.variant_sort_order || a.duration.localeCompare(b.duration, "id")),
    })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "id")).map((category, index) => ({ ...category, position: index + 1 }));

    return {
      name,
      order: Math.min(...variants.map((variant) => variant.sort_order)),
      position: 0,
      imageUrl: variants.find((variant) => variant.image_url)?.image_url ?? null,
      variants,
      categories: groupedCategories,
    };
  }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "id"));

  return sortedServices.map((service, index) => ({ ...service, position: index + 1 }));
}

function percentage(price: string | number, profit: string | number) {
  const sale = Number(price);
  const gain = Number(profit);
  return Number.isFinite(sale) && sale > 0 && Number.isFinite(gain) ? (gain / sale) * 100 : 0;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductMasterRow[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<ProductMasterRow | null>(null);
  const [formMode, setFormMode] = useState<FormMode>("catalog");
  const [formOpen, setFormOpen] = useState(false);
  const [orderingOpen, setOrderingOpen] = useState(false);
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [orderingBusy, setOrderingBusy] = useState(false);
  const [error, setError] = useState("");
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => setProducts(await productMasterService.getProducts()), []);
  useEffect(() => {
    authService.getUserRole().then((role) => setCanEdit(role === "OWNER" || role === "ADMIN"));
    void load();
    return productMasterService.subscribe(load);
  }, [load]);

  useEffect(() => {
    const stored = window.localStorage.getItem("product-view-mode");
    if (stored === "list" || stored === "grid") setViewMode(stored);
  }, []);

  useEffect(() => {
    if (!pendingScrollId) return;
    const timer = window.setTimeout(() => {
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const element = document.getElementById(`variant-${pendingScrollId}-${mobile ? "mobile" : "desktop"}`);
      if (!element) return;
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(pendingScrollId);
      setPendingScrollId(null);
      setSavedNotice(true);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [expandedServices, pendingScrollId, products]);

  useEffect(() => {
    if (!highlightedId) return;
    const timer = window.setTimeout(() => setHighlightedId(null), 2800);
    return () => window.clearTimeout(timer);
  }, [highlightedId]);

  useEffect(() => {
    if (!savedNotice) return;
    const timer = window.setTimeout(() => setSavedNotice(false), 2400);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);

  const groups = useMemo(() => buildGroups(products), [products]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups.map((group) => ({
      ...group,
      categories: group.categories.map((category) => ({
        ...category,
        variants: category.variants.filter((variant) => `${variant.name} ${variant.category} ${variant.duration}`.toLowerCase().includes(needle)),
      })).filter((category) => category.name.toLowerCase().includes(needle) || category.variants.length > 0),
    })).filter((group) => group.name.toLowerCase().includes(needle) || group.categories.length > 0);
  }, [groups, query]);

  const profitPercentage = percentage(form.price, form.profit);

  function openForm(mode: FormMode, name = "", category = "") {
    const service = groups.find((group) => group.name === name);
    setEditing(null);
    setFormMode(mode);
    setError("");
    setForm({
      ...emptyForm,
      name,
      category,
      image_url: service?.imageUrl ?? "",
      image_public_id: service?.variants.find((item) => item.image_public_id)?.image_public_id ?? "",
    });
    setFormOpen(true);
  }

  function beginCreateCatalog() { openForm("catalog"); }
  function beginCreateCategory(name: string) { openForm("category", name); }
  function beginCreateVariant(name: string, category: string) { openForm("variant", name, category); }

  function beginEdit(product: ProductMasterRow) {
    setEditing(product);
    setFormMode("edit");
    setError("");
    setForm({
      name: product.name, category: product.category, duration: product.duration,
      price: String(product.price), profit: String(product.profit_amount), status: product.status,
      image_url: product.image_url ?? "", image_public_id: product.image_public_id ?? "",
    });
    setFormOpen(true);
  }

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/uploads/product", {
        method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setForm((current) => ({ ...current, image_url: result.url, image_public_id: result.publicId }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload gagal");
    } finally {
      setBusy(false);
    }
  }

  async function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const price = Number(form.price);
      const profit = Number(form.profit);
      if (!Number.isFinite(price) || price < 0) throw new Error("Harga jual tidak valid.");
      if (!Number.isFinite(profit) || profit < 0) throw new Error("Jumlah keuntungan tidak valid.");
      if (profit > price) throw new Error("Jumlah keuntungan tidak boleh lebih besar dari harga jual.");

      const name = form.name.trim();
      const category = form.category.trim();
      const duration = form.duration.trim();
      if (!name || !category || !duration) throw new Error("Nama layanan, kategori, dan varian wajib diisi.");

      const targetService = groups.find((group) => group.name === name);
      const targetCategory = targetService?.categories.find((item) => item.name === category);
      if (formMode === "catalog" && targetService) {
        throw new Error("Layanan sudah tersedia. Gunakan tombol Tambah kategori pada layanan tersebut.");
      }
      if (formMode === "variant" && (!targetService || !targetCategory)) {
        throw new Error("Tambah durasi hanya dapat dilakukan pada kategori yang sudah tersedia.");
      }
      if (formMode === "category" && (!targetService || targetCategory)) {
        throw new Error(targetCategory ? "Kategori sudah tersedia. Gunakan tombol Tambah durasi." : "Layanan tidak ditemukan.");
      }
      const staysInSameGroup = editing?.name === name && editing?.category === category;
      const sortOrder = targetService?.order ?? editing?.sort_order ?? groups.length + 1;
      const categorySortOrder = targetCategory?.order ?? (staysInSameGroup ? editing?.category_sort_order : undefined) ?? (targetService?.categories.length ?? 0) + 1;
      const variantSortOrder = (staysInSameGroup ? editing?.variant_sort_order : undefined) ?? (targetCategory?.variants.length ?? 0) + 1;

      const payload = {
        name, category, duration, price, cost: price - profit,
        stock: editing?.stock ?? null, description: editing?.description ?? null,
        status: form.status, image_url: form.image_url || null, image_public_id: form.image_public_id || null,
        sort_order: sortOrder, category_sort_order: categorySortOrder, variant_sort_order: variantSortOrder,
      };
      const saved = editing
        ? await productMasterService.updateProduct(editing.id, payload)
        : await productMasterService.createProduct(payload);

      const latest = await productMasterService.getProducts();
      const siblings = latest.filter((item) => item.name === saved.name && item.category === saved.category)
        .sort((a, b) => a.variant_sort_order - b.variant_sort_order || a.duration.localeCompare(b.duration, "id"));
      await productMasterService.reorderVariants(siblings.map((item, index) => ({ id: item.id, sortOrder: index + 1 })));
      setQuery("");
      setExpandedServices((current) => new Set(current).add(saved.name));
      setFormOpen(false);
      setPendingScrollId(saved.id);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Produk gagal disimpan");
    } finally {
      setBusy(false);
    }
  }

  function removeVariant(product: ProductMasterRow) {
    setDeleteRequest({
      title: `Hapus varian ${product.duration}?`,
      description: `${product.name} · ${product.category} akan kehilangan varian ini.`,
      action: () => productMasterService.deleteProduct(product.id),
    });
  }

  function removeCategory(serviceName: string, categoryName: string) {
    setDeleteRequest({
      title: `Hapus kategori ${categoryName}?`,
      description: `Semua varian di dalam kategori ini akan dihapus dari ${serviceName}.`,
      action: () => productMasterService.deleteCategory(serviceName, categoryName),
    });
  }

  function removeService(serviceName: string) {
    setDeleteRequest({
      title: `Hapus layanan ${serviceName}?`,
      description: "Semua kategori dan varian akan dihapus. Riwayat transaksi tetap tersimpan.",
      action: () => productMasterService.deleteService(serviceName),
    });
  }

  async function confirmDelete() {
    if (!deleteRequest || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteRequest.action();
      setDeleteRequest(null);
      await load();
    } catch (removeError) {
      alert(removeError instanceof Error ? removeError.message : "Data gagal dihapus");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function runOrdering(action: () => Promise<void>) {
    if (orderingBusy) return;
    setOrderingBusy(true);
    try { await action(); await load(); }
    catch (orderingError) { alert(orderingError instanceof Error ? orderingError.message : "Urutan gagal diperbarui"); }
    finally { setOrderingBusy(false); }
  }

  function moveService(serviceName: string, direction: -1 | 1) {
    const current = groups.findIndex((group) => group.name === serviceName);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= groups.length) return;
    const ordered = [...groups];
    [ordered[current], ordered[target]] = [ordered[target], ordered[current]];
    void runOrdering(() => productMasterService.reorderServices(ordered.map((group, index) => ({ name: group.name, sortOrder: index + 1 }))));
  }

  function moveCategory(serviceName: string, categoryName: string, direction: -1 | 1) {
    const service = groups.find((group) => group.name === serviceName);
    if (!service) return;
    const current = service.categories.findIndex((category) => category.name === categoryName);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= service.categories.length) return;
    const ordered = [...service.categories];
    [ordered[current], ordered[target]] = [ordered[target], ordered[current]];
    void runOrdering(() => productMasterService.reorderCategories(serviceName, ordered.map((category, index) => ({ category: category.name, sortOrder: index + 1 }))));
  }

  function moveVariant(serviceName: string, categoryName: string, productId: string, direction: -1 | 1) {
    const variants = groups.find((group) => group.name === serviceName)?.categories.find((category) => category.name === categoryName)?.variants;
    if (!variants) return;
    const current = variants.findIndex((variant) => variant.id === productId);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= variants.length) return;
    const ordered = [...variants];
    [ordered[current], ordered[target]] = [ordered[target], ordered[current]];
    void runOrdering(() => productMasterService.reorderVariants(ordered.map((variant, index) => ({ id: variant.id, sortOrder: index + 1 }))));
  }

  function toggleService(name: string) {
    setExpandedServices((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function chooseViewMode(mode: ViewMode) {
    setViewMode(mode);
    window.localStorage.setItem("product-view-mode", mode);
  }

  const formTitle = {
    catalog: "Tambah layanan baru",
    category: "Tambah kategori baru",
    variant: "Tambah durasi baru",
    edit: "Edit durasi produk",
  }[formMode];
  const formSubtitle = {
    catalog: "Buat layanan, kategori pertama, dan durasi pertamanya.",
    category: `Tambahkan kategori baru ke ${form.name} beserta durasi pertamanya.`,
    variant: `Tambahkan pilihan durasi ke kategori ${form.category}.`,
    edit: "Perbarui durasi, harga, keuntungan, status, atau gambar.",
  }[formMode];

  return <div className="space-y-6 pb-10">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-indigo-600">Katalog WhatsApp Bot</p>
        <h1 className="text-3xl font-bold text-slate-950">Produk & Kategori</h1>
        <p className="mt-1 text-sm text-slate-500">Kelola layanan, kategori, varian harga, gambar, dan susunan menu bot.</p>
      </div>
      {canEdit && <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button className="h-11 sm:h-9" variant="outline" onClick={() => setOrderingOpen(true)}><Settings2 className="mr-2 h-4 w-4" />Atur urutan</Button>
        <Button className="h-11 sm:h-9" onClick={beginCreateCatalog}><Plus className="mr-2 h-4 w-4" />Tambah layanan</Button>
      </div>}
    </div>

    <Card className="border-slate-200"><CardContent className="p-4"><div className="relative">
      <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
      <input className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-indigo-500" placeholder="Cari layanan, kategori, atau varian" value={query} onChange={(event) => setQuery(event.target.value)} />
    </div></CardContent></Card>

    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2 text-xs"><Legend color="bg-indigo-500" text={`${groups.length} layanan`} /><Legend color="bg-cyan-500" text={`${new Set(products.map((item) => `${item.name}:${item.category}`)).size} kategori`} /><Legend color="bg-emerald-500" text={`${products.length} durasi`} /></div>
      <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Pilihan tampilan">
        <button type="button" onClick={() => chooseViewMode("list")} className={`flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-all ${viewMode === "list" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}><List className="h-4 w-4" />Daftar</button>
        <button type="button" onClick={() => chooseViewMode("grid")} className={`flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-all ${viewMode === "grid" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}><LayoutGrid className="h-4 w-4" />Kotak</button>
      </div>
    </div>

    <div className={viewMode === "grid" ? "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3" : "space-y-5"}>{shown.map((service) => {
      const isExpanded = query.trim().length > 0 || expandedServices.has(service.name);
      const compactGrid = viewMode === "grid" && !isExpanded;
      return <Card key={service.name} className={`overflow-hidden border-slate-200 shadow-sm transition-all duration-300 ${viewMode === "grid" && isExpanded ? "col-span-full" : ""}`}>
        <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400" />
        <div className={`flex flex-col gap-4 ${compactGrid ? "p-3 sm:p-4" : "p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between"}`}>
          <button className={`flex min-w-0 flex-1 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${compactGrid ? "flex-col items-center gap-2 text-center" : "items-center gap-4"}`} onClick={() => toggleService(service.name)} aria-expanded={isExpanded}>
            {service.imageUrl ? <img src={service.imageUrl} alt="" className={`${compactGrid ? "h-20 w-20 sm:h-16 sm:w-16" : "h-14 w-14"} rounded-2xl object-cover shadow-md`} /> : <span className={`flex shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ${compactGrid ? "h-20 w-20 sm:h-16 sm:w-16" : "h-14 w-14"}`}><Package className={`${compactGrid ? "h-8 w-8" : "h-6 w-6"}`} /></span>}
            <span className="min-w-0"><span className={`flex items-center gap-2 font-bold text-slate-950 ${compactGrid ? "justify-center text-sm leading-tight sm:text-base" : "text-lg"}`}>{isExpanded ? <ChevronDown className="h-5 w-5 shrink-0" /> : <ChevronRight className="h-5 w-5 shrink-0" />}{service.name}</span><span className={`mt-1 block text-slate-500 ${compactGrid ? "text-xs leading-relaxed" : "text-sm"}`}>{service.categories.length} kategori · {service.variants.length} varian · menu nomor {service.position}</span></span>
          </button>
          {canEdit && <div className="grid grid-cols-[1fr_44px] gap-2 sm:flex">
            <Button className="h-11 sm:h-8" variant="outline" size="sm" onClick={() => beginCreateCategory(service.name)}><Plus className="mr-1.5 h-4 w-4" />{compactGrid ? "Kategori" : "Tambah kategori"}</Button>
            <Button className="group h-11 w-11 overflow-hidden shadow-red-200 transition-all hover:-translate-y-0.5 hover:shadow-lg sm:h-9 sm:w-9" variant="destructive" size="icon" onClick={() => removeService(service.name)} aria-label="Hapus layanan"><Trash2 className="h-4 w-4 transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6" /></Button>
          </div>}
        </div>

        {isExpanded && <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5">{service.categories.map((category) => <div key={`${service.name}:${category.name}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3"><span className="rounded-xl bg-cyan-50 p-2 text-cyan-600"><Layers3 className="h-4 w-4" /></span><div><h3 className="font-bold text-slate-900">{category.name}</h3><p className="text-xs text-slate-500">{category.variants.length} pilihan durasi</p></div></div>
            {canEdit && <div className="grid grid-cols-[1fr_44px] gap-2 sm:flex">
              <Button className="h-11 sm:h-8" variant="outline" size="sm" onClick={() => beginCreateVariant(service.name, category.name)}><Plus className="mr-1.5 h-4 w-4" />Tambah durasi</Button>
              <Button className="group h-11 w-11 overflow-hidden shadow-red-200 transition-all hover:-translate-y-0.5 hover:shadow-lg sm:h-9 sm:w-9" variant="destructive" size="icon" onClick={() => removeCategory(service.name, category.name)} aria-label="Hapus kategori"><Trash2 className="h-4 w-4 transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6" /></Button>
            </div>}
          </div>
          <div className="divide-y divide-slate-100 md:hidden">{category.variants.map((variant, variantIndex) => <motion.div
            id={`variant-${variant.id}-mobile`}
            key={variant.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 transition-all duration-500 ${highlightedId === variant.id ? "bg-emerald-50 ring-2 ring-inset ring-emerald-400" : "bg-white"}`}
          >
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-400">VARIAN #{variantIndex + 1}</p><h4 className="mt-1 text-base font-bold text-slate-950">{variant.duration}</h4></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${variant.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{variant.status}</span></div>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3"><MobileMetric label="Harga" value={formatIDR(variant.price)} /><MobileMetric label="Untung" value={formatIDR(variant.profit_amount)} accent /><MobileMetric label="Margin" value={`${percentage(variant.price, variant.profit_amount).toFixed(1)}%`} accent /></div>
            {canEdit && <div className="mt-4 grid grid-cols-[1fr_48px] gap-2"><Button className="h-12" variant="outline" onClick={() => beginEdit(variant)}><Pencil className="mr-2 h-4 w-4" />Edit varian</Button><Button className="group h-12 w-12 shadow-red-200 transition-all active:scale-95" variant="destructive" size="icon" onClick={() => removeVariant(variant)} aria-label="Hapus varian"><Trash2 className="h-5 w-5 transition-transform group-active:scale-90" /></Button></div>}
          </motion.div>)}</div>
          <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-4 py-3">No.</th><th className="px-4 py-3">Varian</th><th className="px-4 py-3">Harga jual</th><th className="px-4 py-3">Keuntungan</th><th className="px-4 py-3">Persentase</th><th className="px-4 py-3">Status</th>{canEdit && <th className="px-4 py-3 text-right">Aksi</th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">{category.variants.map((variant, variantIndex) => <tr id={`variant-${variant.id}-desktop`} key={variant.id} className={`transition-all duration-500 ${highlightedId === variant.id ? "bg-emerald-50 ring-2 ring-inset ring-emerald-400" : "hover:bg-indigo-50/30"}`}>
              <td className="px-4 py-3 font-semibold text-slate-500">#{variantIndex + 1}</td><td className="px-4 py-3 font-semibold text-slate-900">{variant.duration}</td><td className="px-4 py-3 font-semibold text-slate-900">{formatIDR(variant.price)}</td><td className="px-4 py-3 font-semibold text-emerald-600">{formatIDR(variant.profit_amount)}</td><td className="px-4 py-3 text-emerald-700">{percentage(variant.price, variant.profit_amount).toFixed(1)}%</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${variant.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{variant.status}</span></td>
              {canEdit && <td className="px-4 py-3"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => beginEdit(variant)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button><Button className="group transition-all hover:-translate-y-0.5" variant="destructive" size="icon" onClick={() => removeVariant(variant)} aria-label="Hapus varian"><Trash2 className="h-4 w-4 transition-transform group-hover:scale-110 group-hover:-rotate-6" /></Button></div></td>}
            </tr>)}</tbody>
          </table></div>
        </div>)}</div>}
      </Card>;
    })}</div>

    {shown.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">Tidak ada katalog yang sesuai.</div>}

    <AnimatePresence>{formOpen && <motion.div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div initial={{ opacity: 0, y: 48, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 36, scale: 0.98 }} transition={{ type: "spring", damping: 28, stiffness: 320 }} className="max-h-[96dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-3xl">
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white/95 p-5 backdrop-blur sm:p-6"><div className="pr-4"><h2 className="text-xl font-bold text-slate-950">{formTitle}</h2><p className="mt-1 text-sm leading-5 text-slate-500">{formSubtitle}</p></div><button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-transform active:scale-90" onClick={() => setFormOpen(false)} aria-label="Tutup"><X className="h-5 w-5" /></button></div>
      <form onSubmit={saveProduct} className="grid gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:grid-cols-2 sm:p-6">
        {formMode === "catalog" ? <Field label="Nama layanan/produk" value={form.name} set={(value) => setForm({ ...form, name: value, category: "" })} required hint="Ketik nama layanan baru, misalnya WETV Premium." /> : <ReadOnlyField label="Layanan" value={form.name} />}
        {formMode === "catalog" || formMode === "category" ? <Field label={formMode === "category" ? "Nama kategori baru" : "Kategori pertama"} value={form.category} set={(value) => setForm({ ...form, category: value })} required hint={formMode === "category" ? "Contoh: SHARING, PRIVATE, atau FAMILY." : "Kategori pertama untuk layanan baru."} /> : <ReadOnlyField label="Kategori" value={form.category} />}
        <Field label={formMode === "variant" || formMode === "edit" ? "Durasi" : "Durasi pertama"} value={form.duration} set={(value) => setForm({ ...form, duration: value })} required hint="Contoh: 1 bulan, 3 bulan, atau 1 tahun." />
        <label className="space-y-1 text-sm font-medium text-slate-700">Status<select className="h-12 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-indigo-500 sm:h-11" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as FormState["status"] })}><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select></label>
        <Field label="Harga jual" type="number" value={form.price} set={(value) => setForm({ ...form, price: value })} required />
        <Field label="Jumlah keuntungan" type="number" value={form.profit} set={(value) => setForm({ ...form, profit: value })} required hint="Keuntungan bersih untuk satu transaksi." />
        <div className="flex min-h-20 items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 sm:col-span-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Persentase keuntungan</p><p className="mt-1 text-xs text-emerald-700/70">Dihitung otomatis dari harga jual.</p></div><div className="flex items-center gap-2 text-2xl font-bold text-emerald-700"><Percent className="h-5 w-5" />{profitPercentage.toFixed(2)}%</div></div>
        <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Gambar produk<span className="flex h-12 cursor-pointer items-center justify-center rounded-xl border border-dashed border-indigo-300 bg-indigo-50 text-indigo-700 active:scale-[0.99]"><ImagePlus className="mr-2 h-4 w-4" />{busy ? "Memproses..." : "Pilih gambar"}<input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => upload(event.target.files?.[0])} /></span></label>
        {form.image_url && <div className="sm:col-span-2"><img src={form.image_url} alt="Pratinjau" className="h-24 w-24 rounded-2xl object-cover" /></div>}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">{error}</p>}
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:flex sm:justify-end"><Button className="h-12 sm:h-9" type="button" variant="outline" onClick={() => setFormOpen(false)}>Batal</Button><Button className="h-12 sm:h-9" disabled={busy}><Save className="mr-2 h-4 w-4" />{busy ? "Menyimpan..." : "Simpan"}</Button></div>
      </form>
    </motion.div></motion.div>}</AnimatePresence>

    <AnimatePresence>{orderingOpen && <motion.div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div initial={{ opacity: 0, y: 48, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 36 }} transition={{ type: "spring", damping: 28, stiffness: 320 }} className="flex max-h-[96dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-3xl">
      <div className="flex items-start justify-between border-b border-slate-100 p-5 sm:p-6"><div className="pr-4"><h2 className="text-xl font-bold text-slate-950">Atur urutan katalog</h2><p className="mt-1 text-sm leading-5 text-slate-500">Gunakan tombol naik dan turun. Nomor disusun ulang otomatis tanpa bentrok.</p></div><button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 active:scale-90" onClick={() => setOrderingOpen(false)} aria-label="Tutup"><X className="h-5 w-5" /></button></div>
      <div className="space-y-4 overflow-y-auto bg-slate-50 p-4 sm:p-6">{groups.map((service, serviceIndex) => <div key={service.name} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <OrderRow level="service" position={serviceIndex + 1} title={service.name} subtitle={`${service.categories.length} kategori · ${service.variants.length} varian`} disableUp={serviceIndex === 0} disableDown={serviceIndex === groups.length - 1} disabled={orderingBusy} onUp={() => moveService(service.name, -1)} onDown={() => moveService(service.name, 1)} />
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/70 p-3 sm:p-4">{service.categories.map((category, categoryIndex) => <div key={`${service.name}:${category.name}`} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <OrderRow level="category" position={categoryIndex + 1} title={category.name} subtitle={`${category.variants.length} varian`} disableUp={categoryIndex === 0} disableDown={categoryIndex === service.categories.length - 1} disabled={orderingBusy} onUp={() => moveCategory(service.name, category.name, -1)} onDown={() => moveCategory(service.name, category.name, 1)} />
          <div className="divide-y divide-slate-100 border-t border-slate-100 pl-5 sm:pl-10">{category.variants.map((variant, variantIndex) => <OrderRow key={variant.id} level="variant" position={variantIndex + 1} title={variant.duration} subtitle={formatIDR(variant.price)} disableUp={variantIndex === 0} disableDown={variantIndex === category.variants.length - 1} disabled={orderingBusy} onUp={() => moveVariant(service.name, category.name, variant.id, -1)} onDown={() => moveVariant(service.name, category.name, variant.id, 1)} />)}</div>
        </div>)}</div>
      </div>)}</div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"><p className="text-xs leading-4 text-slate-500">Tersimpan langsung ke katalog WhatsApp.</p><Button className="h-11 shrink-0 sm:h-9" onClick={() => setOrderingOpen(false)}>Selesai</Button></div>
    </motion.div></motion.div>}</AnimatePresence>

    <AnimatePresence>{deleteRequest && <motion.div className="fixed inset-0 z-[70] flex items-end bg-slate-950/50 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="Konfirmasi hapus"><motion.div initial={{ y: 80, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 60, opacity: 0, scale: 0.97 }} transition={{ type: "spring", damping: 24, stiffness: 300 }} className="w-full rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600 sm:mx-0"><motion.div initial={{ rotate: -12, scale: 0.7 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", delay: 0.08 }}><AlertTriangle className="h-8 w-8" /></motion.div></div>
      <h2 className="mt-5 text-center text-xl font-bold text-slate-950 sm:text-left">{deleteRequest.title}</h2>
      <p className="mt-2 text-center text-sm leading-6 text-slate-500 sm:text-left">{deleteRequest.description}</p>
      <div className="mt-6 grid grid-cols-2 gap-3"><Button className="h-12" variant="outline" disabled={deleteBusy} onClick={() => setDeleteRequest(null)}>Batalkan</Button><motion.button whileTap={{ scale: 0.96 }} type="button" disabled={deleteBusy} onClick={confirmDelete} className="flex h-12 items-center justify-center rounded-lg bg-gradient-to-r from-red-600 to-rose-600 px-4 text-sm font-semibold text-white shadow-lg shadow-red-200 transition-shadow hover:shadow-xl disabled:opacity-60"><Trash2 className="mr-2 h-4 w-4" />{deleteBusy ? "Menghapus..." : "Ya, hapus"}</motion.button></div>
    </motion.div></motion.div>}</AnimatePresence>

    <AnimatePresence>{savedNotice && <motion.div initial={{ opacity: 0, y: 24, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }} className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-[80] mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-slate-950 px-4 py-3 text-white shadow-2xl"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500"><CheckCircle2 className="h-5 w-5" /></span><div><p className="text-sm font-bold">Data berhasil disimpan</p><p className="text-xs text-slate-300">Varian terbaru sudah ditampilkan.</p></div></motion.div>}</AnimatePresence>
  </div>;
}

function Legend({ color, text }: { color: string; text: string }) {
  return <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600"><span className={`h-2 w-2 rounded-full ${color}`} />{text}</span>;
}

function Field({ label, value, set, type = "text", required = false, list, hint }: { label: string; value: string; set: (value: string) => void; type?: string; required?: boolean; list?: string; hint?: string }) {
  return <label className="space-y-1 text-sm font-medium text-slate-700"><span>{label}</span><input className="h-12 w-full rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 sm:h-11 sm:text-sm" type={type} min={type === "number" ? 0 : undefined} required={required} list={list} value={value} onChange={(event) => set(event.target.value)} />{hint && <span className="block text-xs font-normal leading-5 text-slate-400">{hint}</span>}</label>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <label className="space-y-1 text-sm font-medium text-slate-700"><span>{label}</span><span className="flex h-12 w-full items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-600 sm:h-11 sm:text-sm">{value}</span></label>;
}

function MobileMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="min-w-0"><p className="text-[11px] font-medium text-slate-400">{label}</p><p className={`mt-1 truncate text-xs font-bold ${accent ? "text-emerald-600" : "text-slate-800"}`}>{value}</p></div>;
}

function OrderRow({ level, position, title, subtitle, disableUp, disableDown, disabled, onUp, onDown }: { level: "service" | "category" | "variant"; position: number; title: string; subtitle: string; disableUp: boolean; disableDown: boolean; disabled: boolean; onUp: () => void; onDown: () => void }) {
  const style = { service: "px-4 py-4", category: "px-4 py-3", variant: "px-3 py-2.5" }[level];
  return <div className={`flex items-center gap-3 ${style}`}>
    <span className={`flex shrink-0 items-center justify-center rounded-lg font-bold ${level === "service" ? "h-9 w-9 bg-indigo-600 text-sm text-white" : level === "category" ? "h-8 w-8 bg-cyan-50 text-xs text-cyan-700" : "h-7 w-7 bg-slate-100 text-[11px] text-slate-600"}`}>{position}</span>
    <div className="min-w-0 flex-1"><p className={`${level === "service" ? "font-bold" : "font-semibold"} truncate text-slate-900`}>{title}</p><p className="truncate text-xs text-slate-500">{subtitle}</p></div>
    <div className="flex shrink-0 gap-1"><button type="button" onClick={onUp} disabled={disabled || disableUp} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-transform active:scale-90 hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-30 sm:h-8 sm:w-8 sm:rounded-lg" aria-label={`Naikkan ${title}`}><ArrowUp className="h-4 w-4" /></button><button type="button" onClick={onDown} disabled={disabled || disableDown} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-transform active:scale-90 hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-30 sm:h-8 sm:w-8 sm:rounded-lg" aria-label={`Turunkan ${title}`}><ArrowDown className="h-4 w-4" /></button></div>
  </div>;
}
