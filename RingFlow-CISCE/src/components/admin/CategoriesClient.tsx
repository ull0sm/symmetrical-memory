"use client";

import React, { useState, useRef } from "react";
import { addCategory, updateCategory, deleteCategory, bulkAddCategories } from "@/actions/categories";
import { uploadCategoryPDFs, PDFUploadResult } from "@/actions/categoryDocs";
import { CategoryInput } from "@/actions/tournament";
import { matchesCategorySearch } from "@/lib/searchUtils";
import * as XLSX from "xlsx";
import { PdfViewerModal } from "@/components/ui/PdfViewerModal";
import { generateAllTournamentDraws, generateCategoryDraw, setCategoryDrawOption, toggleCategoryDrawLock } from "@/actions/draws";
import { downloadAllCategoryDrawPdfs, downloadCategoryDrawPdf } from "@/actions/drawPdfs";
import { exportTournamentResultsCsv, exportTournamentResultsPdf } from "@/actions/resultsExport";
import { DrawBracketModal } from "@/components/draw/DrawBracketModal";
import { CategoryDefinitionsModal } from "@/components/admin/CategoryDefinitionsModal";
import { CategoryDrawDrawer, type CategoryDrawInfo } from "@/components/admin/CategoryDrawDrawer";
import { BulkDrawGenerationModal } from "@/components/admin/BulkDrawGenerationModal";
import { useRouter } from "next/navigation";

type Category = CategoryDrawInfo;

interface Props {
  tournamentId: string;
  initialCategories: Category[];
  readOnly?: boolean;
}

export default function CategoriesClient({
  tournamentId,
  initialCategories,
  readOnly = false,
}: Props) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Category>>({});

  const [isAdding, setIsAdding] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PDF upload state
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [isPdfUploading, setIsPdfUploading] = useState(false);
  const [pdfResult, setPdfResult] = useState<PDFUploadResult | null>(null);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [viewingPdf, setViewingPdf] = useState<{ url: string; title: string } | null>(null);

  // Preview State
  const [previewCategories, setPreviewCategories] = useState<any[]>([]);

  // Digital Draws & Official Rules State
  const [showDefinitionsModal, setShowDefinitionsModal] = useState(false);
  const [bracketModalCategory, setBracketModalCategory] = useState<{ id: string; name: string } | null>(null);
  const [selectedDrawerCategory, setSelectedDrawerCategory] = useState<Category | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [isGeneratingAllDraws, setIsGeneratingAllDraws] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [togglingLockId, setTogglingLockId] = useState<string | null>(null);
  const router = useRouter();
  const [isDownloadingAllPdfs, setIsDownloadingAllPdfs] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  const [addForm, setAddForm] = useState<CategoryInput>({
    name: "",
    age_bracket: "",
    weight_class: "",
    athletes_count: 0
  });

  // Filters and Search State with reload persistence
  const [searchQuery, setSearchQuery] = useState("");
  const [isFilterLoaded, setIsFilterLoaded] = useState(false);

  // Sync with props
  React.useEffect(() => {
    setCategories(initialCategories);
  }, [initialCategories]);

  // Restore search query on mount from URL search params or sessionStorage
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const urlQ = url.searchParams.get("q");
      const savedQ = sessionStorage.getItem(`ringflow_categories_q_${tournamentId}`);
      const initialQ = urlQ ?? savedQ ?? "";
      if (initialQ) setSearchQuery(initialQ);
      setIsFilterLoaded(true);
    }
  }, [tournamentId]);

  // Persist search query changes to URL and sessionStorage
  React.useEffect(() => {
    if (!isFilterLoaded) return;

    if (typeof window !== "undefined") {
      if (searchQuery.trim()) {
        sessionStorage.setItem(`ringflow_categories_q_${tournamentId}`, searchQuery);
      } else {
        sessionStorage.removeItem(`ringflow_categories_q_${tournamentId}`);
      }

      const url = new URL(window.location.href);
      if (searchQuery.trim()) {
        url.searchParams.set("q", searchQuery.trim());
      } else {
        url.searchParams.delete("q");
      }

      window.history.replaceState(null, "", url.toString());
    }
  }, [searchQuery, isFilterLoaded, tournamentId]);

  const hasActiveFilters = Boolean(searchQuery.trim());

  const handleClearFilters = () => {
    setSearchQuery("");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(`ringflow_categories_q_${tournamentId}`);
      const url = new URL(window.location.href);
      url.searchParams.delete("q");
      window.history.replaceState(null, "", url.toString());
    }
  };

  const filteredCategories = React.useMemo(() => {
    if (!searchQuery.trim()) return categories;
    return categories.filter((cat) => {
      const q = searchQuery.toLowerCase().trim();
      const directMatch =
        cat.name.toLowerCase().includes(q) ||
        (cat.age_bracket && cat.age_bracket.toLowerCase().includes(q)) ||
        (cat.weight_class && cat.weight_class.toLowerCase().includes(q));
      if (directMatch) return true;
      return matchesCategorySearch(cat, searchQuery);
    });
  }, [categories, searchQuery]);

  const handleStartAdd = () => {
    setIsAdding(true);
    setAddForm({ name: "", age_bracket: "", weight_class: "", athletes_count: 0 });
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
  };

  const handleSaveAdd = async () => {
    if (!addForm.name) return alert("Name is required");
    try {
      await addCategory(tournamentId, addForm);
      setIsAdding(false);
    } catch (err) {
      alert("Failed to add category");
    }
  };

  const handleStartEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditForm(cat);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      await updateCategory(editingId, tournamentId, {
        name: editForm.name,
        age_bracket: editForm.age_bracket || "",
        weight_class: editForm.weight_class || "",
        athletes_count: editForm.athletes_count,
        expected_matches: editForm.expected_matches
      });
      setEditingId(null);
    } catch (err) {
      alert("Failed to update category");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    try {
      await deleteCategory(id, tournamentId);
    } catch (err) {
      alert("Failed to delete category");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      let parsedCategories: any[] = [];

      if (file.name.endsWith(".json")) {
        const text = await file.text();
        const data = JSON.parse(text);

        let categoriesArray = [];
        if (Array.isArray(data)) {
          categoriesArray = data;
        } else if (data.merged && Array.isArray(data.merged)) {
          categoriesArray = data.merged;
        } else {
          alert("Invalid JSON format. Expected an array of categories or { merged: [...] }");
          return;
        }

        parsedCategories = categoriesArray.map((c: any) => ({
          name: c.category_name || c.name || "Unknown",
          belt: c.belt || "",
          age_min: c.age && typeof c.age === 'object' ? c.age.min : null,
          age_max: c.age && typeof c.age === 'object' ? c.age.max : null,
          sex: c.sex || "",
          day: c.day || data.day || "",
          athletes_count: c.total_rows || c.participants || c.athletes_count || 0,
          age_bracket: c.age && typeof c.age === 'object' ? `${c.age.min}-${c.age.max}` : (typeof c.age === 'string' ? c.age : ""),
          weight_class: c.category || c.weight_class || "",
        })).filter((c: any) => c.name !== "Unknown");
      } else {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet) as any[];

        // Map rows (expects 'category' and 'participants' columns)
        parsedCategories = json.map(row => ({
          name: String(row.category || row.Category || row.name || "Unknown"),
          age_bracket: "",
          weight_class: "",
          athletes_count: parseInt(row.participants || row.Participants || row.count || 0) || 0
        })).filter(c => c.name !== "Unknown");
      }

      if (parsedCategories.length === 0) {
        alert("No valid categories found in file.");
        return;
      }

      setPreviewCategories(parsedCategories);

    } catch (err) {
      console.error(err);
      alert("Error parsing file.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleApproveUpload = async () => {
    setIsUploading(true);
    try {
      await bulkAddCategories(tournamentId, previewCategories);
      setPreviewCategories([]);
    } catch (err) {
      console.error(err);
      alert("Error saving to database.");
    } finally {
      setIsUploading(false);
    }
  };

  // ── PDF Upload Handlers ──────────────────────────────────────────────────
  const handlePdfFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    setPdfFiles(files);
    setShowPdfModal(true);
    setPdfResult(null);
    // Reset input so same files can be re-selected
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  // PDF staged preview with overwrite detection
  const stagedPDFs = React.useMemo(() => {
    return pdfFiles.map((file) => {
      const candidateName = file.name.replace(/\.pdf$/i, "").trim();
      const norm = candidateName.toLowerCase().trim().replace(/\s+/g, " ").replace(/\./g, "");

      const exact = categories.find(
        (c) => c.name.toLowerCase().trim().replace(/\s+/g, " ").replace(/\./g, "") === norm
      );
      const matched =
        exact ||
        categories.find((c) => {
          const catNorm = c.name.toLowerCase().trim().replace(/\s+/g, " ").replace(/\./g, "");
          return catNorm.includes(norm) || norm.includes(catNorm);
        }) ||
        null;

      return {
        file,
        matchedCategory: matched,
        isOverwrite: Boolean(matched?.doc_url),
      };
    });
  }, [pdfFiles, categories]);

  const overwrites = stagedPDFs.filter((s) => s.isOverwrite);
  const newUploads = stagedPDFs.filter((s) => s.matchedCategory && !s.isOverwrite);
  const unmatches = stagedPDFs.filter((s) => !s.matchedCategory);

  const handlePdfSubmit = async () => {
    if (pdfFiles.length === 0) return;
    setIsPdfUploading(true);
    try {
      const formData = new FormData();
      pdfFiles.forEach((f) => formData.append("pdfs", f));
      const result = await uploadCategoryPDFs(tournamentId, formData);
      setPdfResult(result);
      if (result.matched.length > 0) {
        setCategories((prev) =>
          prev.map((c) => {
            const match = result.matched.find((m) => m.categoryId === c.id);
            return match && match.docUrl ? { ...c, doc_url: match.docUrl } : c;
          })
        );
      }
    } catch (err: any) {
      alert(err?.message ?? "Failed to upload PDFs.");
    } finally {
      setIsPdfUploading(false);
    }
  };

  // ── Digital Draws & Bulk PDF Handlers ───────────────────────────────────────
  const handleGenerateAllDraws = () => {
    setShowBulkModal(true);
  };

  const handleDownloadAllDrawPdfs = async () => {
    try {
      setIsDownloadingAllPdfs(true);
      const res = await downloadAllCategoryDrawPdfs(tournamentId);
      if (res.success && res.base64) {
        const byteCharacters = atob(res.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "application/zip" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = res.filename;
        link.click();
      } else {
        alert(res.error || "No draw PDFs found to download.");
      }
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setIsDownloadingAllPdfs(false);
    }
  };

  /**
   * The post-event record for the association: every bout with its score line,
   * as a spreadsheet to keep and a printable PDF to sign.
   */
  const handleExportResults = async (format: "csv" | "pdf") => {
    setExporting(format);
    try {
      const res =
        format === "csv"
          ? await exportTournamentResultsCsv(tournamentId)
          : await exportTournamentResultsPdf(tournamentId);

      if (!res.success || !res.base64) {
        alert(("error" in res && res.error) || "Could not build the results record.");
        return;
      }

      const byteCharacters = atob(res.base64);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i += 1) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([byteNumbers], {
        type: format === "csv" ? "text/csv;charset=utf-8" : "application/pdf",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = res.filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      alert(`Export failed: ${err?.message ?? "unknown error"}`);
    } finally {
      setExporting(null);
    }
  };

  /** Rebuild one category's bracket, using its own bronze setting. */
  const handleGenerateOneDraw = async (cat: any) => {
    if (cat.is_locked) {
      const unlockFirst = confirm(
        `Category "${cat.name}" draw is LOCKED to protect matches.\n\nRegenerating will replace this bracket. Do you want to unlock and regenerate?`
      );
      if (!unlockFirst) return;
    } else if (cat.confirmed_matches > 0) {
      const forceOk = confirm(
        `CAUTION: Category "${cat.name}" already has ${cat.confirmed_matches} completed match(es).\n\nRegenerating will wipe these matches and create a new bracket. Are you absolutely sure you want to proceed?`
      );
      if (!forceOk) return;
    }

    setRegeneratingId(cat.id);
    try {
      const res = await generateCategoryDraw(cat.id, { forceRegenerate: true });
      if (!res.success) {
        alert(res.error || "Could not generate the draw for this category.");
        return;
      }
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Could not generate the draw for this category.");
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleToggleLock = async (cat: Category) => {
    if (!cat.has_draw && !cat.draw_state) {
      alert("Please generate a digital draw for this category first before locking.");
      return;
    }
    setTogglingLockId(cat.id);
    try {
      const res = await toggleCategoryDrawLock(cat.id);
      if (!res.success) {
        alert(res.error || "Failed to update draw lock state.");
        return;
      }
      setCategories((prev) =>
        prev.map((c) =>
          c.id === cat.id
            ? {
                ...c,
                is_locked: res.state === "LOCKED",
                draw_state: res.state,
              }
            : c
        )
      );
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to toggle draw lock.");
    } finally {
      setTogglingLockId(null);
    }
  };

  /**
   * Record how many bronze medals this category awards. Stored on the category;
   * it takes effect the next time the draw is generated.
   */
  const handleBronzeChange = async (cat: any, value: string) => {
    const bronzeMedals = value === "inherit" ? null : (Number(value) as 0 | 1 | 2 | 3);
    const res = await setCategoryDrawOption(cat.id, bronzeMedals);
    if (!res.success) {
      alert(res.error || "Could not save the bronze setting.");
      return;
    }
    setCategories((prev) =>
      prev.map((c) => (c.id === cat.id ? { ...c, bronze_medals: bronzeMedals } : c))
    );
    // An existing bracket was built with the old setting; offer the rebuild.
    if (window.confirm(
      "Bronze setting saved. Regenerate this category's draw now so the bracket matches?"
    )) {
      await handleGenerateOneDraw(cat);
    }
  };

  const handleDownloadSinglePdf = async (categoryId: string) => {
    try {
      const res = await downloadCategoryDrawPdf(categoryId);
      if (res.success && res.base64) {
        const byteCharacters = atob(res.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = res.filename;
        link.click();
      }
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    }
  };

  const closePdfModal = () => {
    setShowPdfModal(false);
    setPdfFiles([]);
    setPdfResult(null);
  };

  return (
    <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 sm:space-y-8 bg-surface pb-24 w-full">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-headline-sm text-headline-sm text-primary">Division Management</h2>
          <p className="text-body-sm text-on-surface-variant">View and manage categories for this tournament.</p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2 sm:gap-4">
            {/* Hidden file inputs */}
            <input
              type="file"
              accept=".xlsx, .xls, .csv, .json"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <input
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              ref={pdfInputRef}
              onChange={handlePdfFileChange}
            />
            {/* JSON/Excel upload */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isAdding}
              className="px-4 py-2 border border-outline text-primary font-label-caps text-label-caps rounded flex items-center gap-2 hover:bg-surface-container-low disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">upload</span> {isUploading ? "UPLOADING..." : "UPLOAD JSON/EXCEL"}
            </button>
            {/* Bulk PDF upload */}
            <button
              onClick={() => pdfInputRef.current?.click()}
              disabled={isPdfUploading || isAdding}
              className="px-4 py-2 border border-outline text-primary font-label-caps text-label-caps rounded flex items-center gap-2 hover:bg-surface-container-low disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
              {isPdfUploading ? "UPLOADING..." : "UPLOAD PDFs"}
            </button>

            {/* Official Category Definitions */}
            <button
              onClick={() => setShowDefinitionsModal(true)}
              className="px-4 py-2 border border-[#0E9C7C] text-[#0E9C7C] bg-emerald-50/50 hover:bg-emerald-50 font-label-caps text-label-caps rounded flex items-center gap-2 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">rule</span> OFFICIAL RULES
            </button>

            {/* Generate All Draws */}
            <button
              onClick={handleGenerateAllDraws}
              disabled={isGeneratingAllDraws || categories.length === 0}
              className="px-4 py-2 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-label-caps text-label-caps rounded flex items-center gap-2 transition-all shadow-xs cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">account_tree</span>
              {isGeneratingAllDraws ? "GENERATING..." : "GENERATE ALL DRAWS"}
            </button>

            {/* Download All Draw PDFs (ZIP) */}
            <button
              onClick={handleDownloadAllDrawPdfs}
              disabled={isDownloadingAllPdfs || categories.length === 0}
              className="px-4 py-2 bg-[#1B1815] hover:bg-[#3D3A33] text-white font-label-caps text-label-caps rounded flex items-center gap-2 transition-all shadow-xs cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">download_for_offline</span>
              {isDownloadingAllPdfs ? "PACKAGING..." : "DOWNLOAD ALL DRAWS (ZIP)"}
            </button>

            {/* Results record for the association: CSV to keep, PDF to sign */}
            <button
              onClick={() => void handleExportResults("csv")}
              disabled={exporting !== null || categories.length === 0}
              title="Every bout with its score line, as a spreadsheet"
              className="px-4 py-2 bg-[#1B1815] hover:bg-[#3D3A33] text-white font-label-caps text-label-caps rounded flex items-center gap-2 transition-all shadow-xs cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">table_view</span>
              {exporting === "csv" ? "BUILDING…" : "RESULTS CSV"}
            </button>

            <button
              onClick={() => void handleExportResults("pdf")}
              disabled={exporting !== null || categories.length === 0}
              title="Printable results record with signature lines"
              className="px-4 py-2 bg-[#1B1815] hover:bg-[#3D3A33] text-white font-label-caps text-label-caps rounded flex items-center gap-2 transition-all shadow-xs cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">description</span>
              {exporting === "pdf" ? "BUILDING…" : "RESULTS PDF"}
            </button>

            {/* Add category */}
            <button
              onClick={handleStartAdd}
              disabled={isAdding || isUploading}
              className="px-4 py-2 bg-primary text-white font-label-caps text-label-caps rounded flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">add</span> ADD CATEGORY
            </button>
          </div>
        )}
      </div>

      {/* ─── Dedicated Search & Filters Bar (matches Athletes section style) ─── */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400 pointer-events-none">
              search
            </span>
            <input 
              type="text" 
              placeholder="Search by category name, age bracket, or weight class (e.g. u14, 30-35kg, boys)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full bg-[#FAF9F5] border rounded-lg pl-9 pr-8 py-2 text-sm outline-none transition-all shadow-2xs ${
                searchQuery.trim()
                  ? "border-[#0E9C7C] ring-2 ring-[#0E9C7C]/20 font-medium text-primary"
                  : "border-outline-variant focus:border-[#0E9C7C]"
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer p-0.5"
                title="Clear search text"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>

          {/* Highlighted Clear Filters Button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="group flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-[0_0_16px_rgba(5,150,105,0.4)] hover:shadow-[0_0_24px_rgba(5,150,105,0.65)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 cursor-pointer shrink-0 animate-in fade-in zoom-in-95"
              title="Filter is active. Click to clear and view all categories."
            >
              <span className="material-symbols-outlined text-[16px] group-hover:rotate-90 transition-transform duration-200">
                filter_alt_off
              </span>
              <span className="tracking-wide uppercase">Clear Filter</span>
            </button>
          )}
        </div>

        {/* Active Filter Notification Banner */}
        {hasActiveFilters && (
          <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 animate-in fade-in">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold flex items-center gap-1 text-[#0B7C63]">
                <span className="w-2 h-2 rounded-full bg-[#0E9C7C] animate-pulse" />
                Active Filter:
              </span>
              <span className="text-slate-600">
                Showing <strong>{filteredCategories.length}</strong> of <strong>{categories.length}</strong> categories
              </span>
              {searchQuery.trim() && (
                <span className="px-2 py-0.5 rounded-md bg-[#FAF9F5] border border-emerald-200 text-[#0B7C63] font-medium flex items-center gap-1">
                  Query: &ldquo;{searchQuery}&rdquo;
                  <button type="button" onClick={() => setSearchQuery("")} className="hover:text-red-500 cursor-pointer text-xs">×</button>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleClearFilters}
              className="text-[11px] font-bold text-[#0B7C63] hover:text-emerald-800 underline shrink-0 cursor-pointer"
            >
              Clear to view all
            </button>
          </div>
        )}
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full table-fixed min-w-[340px] sm:min-w-0 text-left border-collapse">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr>
              <th className={`${readOnly ? "w-[38%] sm:w-[38%] md:w-[32%]" : "w-[28%] sm:w-[28%] md:w-[26%]"} px-2.5 sm:px-4 md:px-6 py-3 sm:py-4 font-label-caps text-[11.5px] sm:text-label-caps text-on-surface-variant`}>Name</th>
              <th className={`${readOnly ? "w-[16%] sm:w-[16%] md:w-[15%]" : "w-[14%] sm:w-[14%] md:w-[12%]"} px-1.5 sm:px-3 md:px-4 py-3 sm:py-4 font-label-caps text-[11.5px] sm:text-label-caps text-on-surface-variant`}>Age</th>
              <th className={`${readOnly ? "w-[18%] sm:w-[18%] md:w-[15%]" : "w-[16%] sm:w-[16%] md:w-[12%]"} px-1.5 sm:px-3 md:px-4 py-3 sm:py-4 font-label-caps text-[11.5px] sm:text-label-caps text-on-surface-variant`}>Weight</th>
              <th className={`${readOnly ? "w-[14%] sm:w-[14%] md:w-[10%]" : "w-[12%] sm:w-[12%] md:w-[9%]"} px-1.5 sm:px-2 md:px-4 py-3 sm:py-4 font-label-caps text-[11.5px] sm:text-label-caps text-on-surface-variant text-center whitespace-nowrap`}>Athletes</th>
              <th className="w-[16%] sm:w-[16%] md:w-[15%] px-2 md:px-3 py-3 sm:py-4 font-label-caps text-[11.5px] sm:text-label-caps text-on-surface-variant text-center">Draw State</th>
              <th className="hidden md:table-cell md:w-[10%] px-2 md:px-4 py-3 sm:py-4 font-label-caps text-label-caps text-on-surface-variant text-center">Matches</th>
              {!readOnly && (
                <th className="w-[14%] sm:w-[14%] md:w-[16%] px-2 sm:px-4 md:px-6 py-3 sm:py-4 font-label-caps text-[11.5px] sm:text-label-caps text-on-surface-variant text-right">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="font-body-sm text-body-sm divide-y divide-outline-variant">
            {/* Add Row */}
            {isAdding && (
              <tr className="bg-surface-container-low">
                <td className="px-2.5 sm:px-4 md:px-6 py-2"><input value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="Name" className="w-full p-1.5 sm:p-2 text-xs sm:text-sm border rounded" /></td>
                <td className="px-1.5 sm:px-3 md:px-4 py-2"><input value={addForm.age_bracket} onChange={e => setAddForm({ ...addForm, age_bracket: e.target.value })} placeholder="Age" className="w-full p-1.5 sm:p-2 text-xs sm:text-sm border rounded" /></td>
                <td className="px-1.5 sm:px-3 md:px-4 py-2"><input value={addForm.weight_class} onChange={e => setAddForm({ ...addForm, weight_class: e.target.value })} placeholder="Weight" className="w-full p-1.5 sm:p-2 text-xs sm:text-sm border rounded" /></td>
                <td className="px-1 sm:px-2 md:px-4 py-2"><input type="number" value={addForm.athletes_count} onChange={e => setAddForm({ ...addForm, athletes_count: parseInt(e.target.value) || 0 })} className="w-full p-1.5 sm:p-2 text-xs sm:text-sm border rounded text-center font-data-mono" /></td>
                <td className="px-2 md:px-3 py-2 text-center text-xs font-data-mono text-on-surface-variant">-</td>
                <td className="hidden md:table-cell px-2 md:px-4 py-2 text-center text-on-surface-variant text-xs font-data-mono">Auto</td>
                <td className="px-2 sm:px-4 md:px-6 py-2 text-right">
                  <div className="flex gap-1.5 sm:gap-2 justify-end">
                    <button onClick={handleSaveAdd} className="px-2.5 sm:px-3 py-1 bg-primary text-white rounded font-label-caps text-[10px]">SAVE</button>
                    <button onClick={handleCancelAdd} className="px-2.5 sm:px-3 py-1 border rounded font-label-caps text-[10px]">CANCEL</button>
                  </div>
                </td>
              </tr>
            )}

            {filteredCategories.map((cat) => (
              editingId === cat.id ? (
                <tr key={cat.id} className="bg-surface-container-low">
                  <td className="px-2.5 sm:px-4 md:px-6 py-2"><input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full p-1.5 sm:p-2 text-xs sm:text-sm border rounded" /></td>
                  <td className="px-1.5 sm:px-3 md:px-4 py-2"><input value={editForm.age_bracket || ""} onChange={e => setEditForm({ ...editForm, age_bracket: e.target.value })} className="w-full p-1.5 sm:p-2 text-xs sm:text-sm border rounded" /></td>
                  <td className="px-1.5 sm:px-3 md:px-4 py-2"><input value={editForm.weight_class || ""} onChange={e => setEditForm({ ...editForm, weight_class: e.target.value })} className="w-full p-1.5 sm:p-2 text-xs sm:text-sm border rounded" /></td>
                  <td className="px-1 sm:px-2 md:px-4 py-2"><input type="number" value={editForm.athletes_count} onChange={e => setEditForm({ ...editForm, athletes_count: parseInt(e.target.value) || 0 })} className="w-full p-1.5 sm:p-2 text-xs sm:text-sm border rounded text-center font-data-mono" /></td>
                  <td className="hidden md:table-cell px-2 md:px-4 py-2"><input type="number" value={editForm.expected_matches} onChange={e => setEditForm({ ...editForm, expected_matches: parseInt(e.target.value) || 0 })} className="w-full p-1.5 sm:p-2 text-xs sm:text-sm border rounded text-center font-data-mono" /></td>
                  <td className="px-2 sm:px-4 md:px-6 py-2 text-right">
                    <div className="flex gap-1.5 sm:gap-2 justify-end">
                      <button onClick={handleSaveEdit} className="px-2.5 sm:px-3 py-1 bg-secondary text-white rounded font-label-caps text-[10px]">SAVE</button>
                      <button onClick={handleCancelEdit} className="px-2.5 sm:px-3 py-1 border rounded font-label-caps text-[10px]">CANCEL</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={cat.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="px-2.5 sm:px-4 md:px-6 py-3 sm:py-4 font-bold text-primary break-words">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      {cat.name}
                      {cat.doc_url && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingPdf({ url: cat.doc_url!, title: cat.name });
                          }}
                          title="View athlete list PDF"
                          className="material-symbols-outlined text-[15px] text-outline hover:text-primary transition-colors shrink-0 cursor-pointer"
                          style={{ fontVariationSettings: "'FILL' 0" }}
                        >
                          article
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="px-1.5 sm:px-3 md:px-4 py-3 sm:py-4 break-words text-on-surface">{cat.age_bracket || "-"}</td>
                  <td className="px-1.5 sm:px-3 md:px-4 py-3 sm:py-4 break-words text-on-surface">{cat.weight_class || "-"}</td>
                  <td className="px-1 sm:px-2 md:px-4 py-3 sm:py-4 text-center font-data-mono text-on-surface text-sm sm:text-base font-medium">
                    {cat.athletes_count}
                  </td>
                  
                  {/* Draw Lifecycle State Pill */}
                  <td className="px-2 md:px-3 py-3 sm:py-4 text-center">
                    <button
                      type="button"
                      onClick={() => setSelectedDrawerCategory(cat)}
                      className="cursor-pointer transition-transform hover:scale-105"
                      title="Click to manage draw lifecycle & bronze settings"
                    >
                      {(() => {
                        const confirmed = cat.confirmed_matches ?? 0;
                        const live = cat.live_matches ?? 0;
                        const total = cat.total_matches ?? cat.expected_matches ?? 0;
                        const hasDraw = Boolean(cat.has_draw || cat.draw_state);
                        const isLocked = Boolean(cat.is_locked || cat.draw_state === "LOCKED");

                        const versionBadge = (cat.draw_version || cat.drawVersion) ? ` v${cat.draw_version || cat.drawVersion}` : "";

                        if (!hasDraw) {
                          return (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold font-data-mono text-slate-500 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                              No Draw
                            </span>
                          );
                        }
                        if (total > 0 && confirmed >= total) {
                          return (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold font-data-mono text-emerald-950 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 px-2 py-0.5 rounded-full">
                              <span className="material-symbols-outlined text-[13px] text-amber-600">workspace_premium</span>
                              Finished{versionBadge}
                            </span>
                          );
                        }
                        if (confirmed > 0 || live > 0) {
                          return (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold font-data-mono text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Live {confirmed}/{total}{versionBadge}
                            </span>
                          );
                        }
                        if (isLocked) {
                          return (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold font-data-mono text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-full">
                              <span className="material-symbols-outlined text-[12px]">lock</span>
                              Official{versionBadge}
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold font-data-mono text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Draft{versionBadge}
                          </span>
                        );
                      })()}
                    </button>
                  </td>

                  <td className="hidden md:table-cell px-2 md:px-4 py-3 sm:py-4 text-center font-data-mono">{cat.expected_matches}</td>
                  {!readOnly && (
                    <td className="px-2 sm:px-4 md:px-6 py-3 sm:py-4 text-right">
                      <div className="flex justify-end items-center gap-2 sm:gap-2.5">
                        {/* Digital Bracket Tree Modal */}
                        <button
                          type="button"
                          onClick={() => setBracketModalCategory({ id: cat.id, name: cat.name })}
                          title="View interactive digital draw bracket"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg hover:bg-emerald-50 text-[#0E9C7C] hover:text-[#0B7C63] transition-colors cursor-pointer shrink-0"
                        >
                          <span className="material-symbols-outlined text-[18px]">account_tree</span>
                        </button>

                        {/* Manage Draw Drawer */}
                        <button
                          type="button"
                          onClick={() => setSelectedDrawerCategory(cat)}
                          title="Draw Lifecycle & Bronze Settings"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg hover:bg-stone-100 text-[#504C42] hover:text-[#1B1815] transition-colors cursor-pointer shrink-0"
                        >
                          <span className="material-symbols-outlined text-[18px]">tune</span>
                        </button>

                        {/* Download Draw Sheet PDF */}
                        <button
                          type="button"
                          onClick={() => handleDownloadSinglePdf(cat.id)}
                          title="Download official draw sheet PDF"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg hover:bg-stone-100 text-[#3D3A33] hover:text-[#1B1815] transition-colors cursor-pointer shrink-0"
                        >
                          <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(cat)}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg hover:bg-stone-100 text-outline hover:text-primary transition-colors cursor-pointer shrink-0"
                          title="Edit category"
                        >
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(cat.id)}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg hover:bg-red-50 text-outline hover:text-error transition-colors cursor-pointer shrink-0"
                          title="Delete category"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            ))}

            {(!filteredCategories || (filteredCategories.length === 0 && !isAdding)) && (
              <tr>
                <td colSpan={readOnly ? 5 : 6} className="px-6 py-8 text-center text-on-surface-variant italic">
                  {searchQuery.trim() ? `No categories match "${searchQuery}".` : "No categories found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Preview Modal */}
      {previewCategories.length > 0 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest w-full max-w-4xl max-h-[80vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface-container-low shrink-0">
              <div>
                <h2 className="text-xl font-bold text-primary mb-1">Preview Upload</h2>
                <p className="text-xs text-on-surface-variant">Review the {previewCategories.length} categories extracted from your file.</p>
              </div>
              <button onClick={() => setPreviewCategories([])} className="material-symbols-outlined text-outline hover:text-error transition-colors">close</button>
            </div>

            <div className="flex-1 overflow-auto p-6 bg-surface-container-lowest">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant text-[10px] font-label-caps text-on-surface-variant uppercase tracking-wider">
                    <th className="py-2">Category Name</th>
                    <th className="py-2">Age</th>
                    <th className="py-2">Weight Class</th>
                    <th className="py-2">Sex</th>
                    <th className="py-2">Belt</th>
                    <th className="py-2">Day</th>
                    <th className="py-2">Count</th>
                  </tr>
                </thead>
                <tbody className="text-sm font-body-md text-on-surface">
                  {previewCategories.map((cat, i) => (
                    <tr key={i} className="border-b border-outline-variant/30 hover:bg-surface-container-highest/30 transition-colors">
                      <td className="py-2 font-bold text-primary">{cat.name}</td>
                      <td className="py-2">{cat.age_bracket || (cat.age_min !== null && cat.age_max !== null ? `${cat.age_min}-${cat.age_max}` : "-")}</td>
                      <td className="py-2">{cat.weight_class || "-"}</td>
                      <td className="py-2">{cat.sex || "-"}</td>
                      <td className="py-2">{cat.belt || "-"}</td>
                      <td className="py-2">{cat.day || "-"}</td>
                      <td className="py-2 font-data-mono">{cat.athletes_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-6 border-t border-outline-variant bg-surface-container-low flex justify-between items-center shrink-0">
              <button
                onClick={() => setPreviewCategories([])}
                className="px-6 py-2 rounded font-bold text-primary hover:bg-surface-container transition-colors disabled:opacity-50"
                disabled={isUploading}
              >
                CANCEL
              </button>
              <button
                onClick={handleApproveUpload}
                disabled={isUploading}
                className="px-6 py-2 rounded font-bold bg-secondary text-on-secondary hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50"
              >
                {isUploading ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" /> PUSHING...</> : "APPROVE & UPLOAD"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF Upload Modal ─────────────────────────────────────────── */}
      {showPdfModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface-container-low shrink-0">
              <div>
                <h2 className="text-xl font-bold text-primary mb-1">Upload Athlete List PDFs</h2>
                <p className="text-xs text-on-surface-variant">
                  {pdfResult
                    ? `Completed - ${pdfResult.matched.length} uploaded, ${pdfResult.unmatched.length} unmatched${pdfResult.errors.length > 0 ? `, ${pdfResult.errors.length} errors` : ""
                    }`
                    : overwrites.length > 0
                      ? `⚠️ ${overwrites.length} existing PDF${overwrites.length > 1 ? "s" : ""} will be overwritten upon confirmation.`
                      : `${pdfFiles.length} PDF${pdfFiles.length !== 1 ? "s" : ""} selected. Matched by filename → category.`}
                </p>
              </div>
              <button onClick={closePdfModal} className="material-symbols-outlined text-outline hover:text-error transition-colors">close</button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto p-6 bg-surface-container-lowest space-y-4">
              {!pdfResult ? (
                pdfFiles.length === 0 ? (
                  <p className="text-on-surface-variant text-sm italic">No PDFs selected.</p>
                ) : (
                  <div className="space-y-4">
                    {/* Overwrite Warning Section */}
                    {overwrites.length > 0 && (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
                        <div className="flex items-start gap-2.5">
                          <span className="material-symbols-outlined text-amber-500 text-xl shrink-0 mt-0.5">warning</span>
                          <div>
                            <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                              {overwrites.length} {overwrites.length === 1 ? "Category Already Has a PDF" : "Categories Already Have PDFs"}
                            </h4>
                            <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                              The following categories already have an athlete list attached. Uploading will <strong>overwrite</strong> them. You can preview the existing PDF before confirming:
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1.5 pt-1 max-h-48 overflow-y-auto pr-1">
                          {overwrites.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between gap-3 bg-surface-container-lowest/90 border border-amber-500/25 rounded-lg px-3 py-2 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="material-symbols-outlined text-[16px] text-amber-500 shrink-0">picture_as_pdf</span>
                                <span className="font-semibold text-on-surface truncate">{item.file.name}</span>
                                <span className="text-on-surface-variant text-[11px] shrink-0">→ {item.matchedCategory?.name}</span>
                              </div>
                              {item.matchedCategory?.doc_url && (
                                <a
                                  href={item.matchedCategory.doc_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-[11px] font-semibold text-primary transition-colors border border-outline-variant/40"
                                  title="Open the existing PDF in a new tab"
                                >
                                  <span>View Existing PDF</span>
                                  <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* New Attachments Section */}
                    {newUploads.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-label-caps text-on-surface-variant">
                          NEW ATTACHMENTS ({newUploads.length})
                        </p>
                        <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                          {newUploads.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs bg-surface-container-low px-3 py-2 rounded-lg">
                              <span className="material-symbols-outlined text-[16px] text-primary shrink-0">picture_as_pdf</span>
                              <span className="text-on-surface font-medium truncate">{item.file.name}</span>
                              <span className="text-on-surface-variant text-[11px] shrink-0">→ {item.matchedCategory?.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Unmatched Files Section */}
                    {unmatches.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-label-caps text-error">
                          NO CATEGORY MATCH ({unmatches.length})
                        </p>
                        <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                          {unmatches.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs bg-error/5 border border-error/20 px-3 py-2 rounded-lg text-error">
                              <span className="material-symbols-outlined text-[16px] shrink-0">help</span>
                              <span className="truncate">{item.file.name}</span>
                              <span className="text-[11px] opacity-75 shrink-0">(no category match found)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              ) : (
                // Results View
                <div className="space-y-4">
                  {pdfResult.matched.length > 0 && (
                    <div>
                      <p className="text-xs font-label-caps text-on-surface-variant mb-1.5">UPLOADED & ATTACHED ({pdfResult.matched.length})</p>
                      <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {pdfResult.matched.map((m, i) => (
                          <li key={i} className="flex items-center justify-between gap-3 text-xs bg-surface-container-low px-3 py-2 rounded-lg">
                            <div className="flex items-center gap-2 truncate">
                              <span className="material-symbols-outlined text-[16px] text-green-600 shrink-0">check_circle</span>
                              <span className="text-on-surface font-medium truncate">{m.filename}</span>
                              <span className="text-on-surface-variant text-[11px] shrink-0">→ {m.categoryName}</span>
                            </div>
                            {m.docUrl && (
                              <a
                                href={m.docUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                              >
                                <span>View</span>
                                <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {pdfResult.unmatched.length > 0 && (
                    <div>
                      <p className="text-xs font-label-caps text-on-surface-variant mb-1">SKIPPED - NO MATCH ({pdfResult.unmatched.length})</p>
                      <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                        {pdfResult.unmatched.map((name, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs text-on-surface bg-surface-container-low px-3 py-2 rounded-lg">
                            <span className="material-symbols-outlined text-[16px] text-amber-500 shrink-0">warning</span>
                            <span className="truncate">{name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {pdfResult.errors.length > 0 && (
                    <div>
                      <p className="text-xs font-label-caps text-error mb-1">ERRORS ({pdfResult.errors.length})</p>
                      <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                        {pdfResult.errors.map((e, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs bg-error/5 border border-error/20 p-2.5 rounded-lg text-error">
                            <span className="material-symbols-outlined text-[16px] text-error shrink-0">error</span>
                            <span className="truncate">{e.filename}: {e.error}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-outline-variant bg-surface-container-low flex justify-between items-center shrink-0">
              <button
                onClick={closePdfModal}
                className="px-6 py-2 rounded font-bold text-primary hover:bg-surface-container transition-colors"
              >
                {pdfResult ? "CLOSE" : "CANCEL"}
              </button>
              {!pdfResult && (
                <button
                  onClick={handlePdfSubmit}
                  disabled={isPdfUploading || stagedPDFs.filter((s) => s.matchedCategory).length === 0}
                  className={`px-6 py-2 rounded font-bold transition-opacity flex items-center gap-2 disabled:opacity-50 ${overwrites.length > 0
                      ? "bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                      : "bg-secondary text-on-secondary hover:opacity-90"
                    }`}
                >
                  {isPdfUploading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
                      {overwrites.length > 0 ? "OVERWRITING..." : "UPLOADING..."}
                    </>
                  ) : overwrites.length > 0 ? (
                    <>
                      <span className="material-symbols-outlined text-[18px]">warning</span>
                      CONFIRM & OVERWRITE ({stagedPDFs.filter((s) => s.matchedCategory).length})
                    </>
                  ) : (
                    <>UPLOAD {newUploads.length} PDF{newUploads.length !== 1 ? "S" : ""}</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Digital Draw Bracket Modal */}
      {bracketModalCategory && (
        <DrawBracketModal
          categoryId={bracketModalCategory.id}
          categoryName={bracketModalCategory.name}
          isOpen={Boolean(bracketModalCategory)}
          onClose={() => setBracketModalCategory(null)}
        />
      )}

      {/* Official Category Definitions Manager Modal */}
      <CategoryDefinitionsModal
        tournamentId={tournamentId}
        isOpen={showDefinitionsModal}
        onClose={() => setShowDefinitionsModal(false)}
        onSaved={() => {
          window.location.reload();
        }}
      />

      {/* Category Draw Management Drawer */}
      <CategoryDrawDrawer
        isOpen={Boolean(selectedDrawerCategory)}
        onClose={() => setSelectedDrawerCategory(null)}
        category={selectedDrawerCategory}
        tournamentId={tournamentId}
        onViewBracket={(cat) => setBracketModalCategory({ id: cat.id, name: cat.name })}
        onRefresh={() => router.refresh()}
      />

      {/* Bulk Draw Generation Preflight Modal */}
      <BulkDrawGenerationModal
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        tournamentId={tournamentId}
        onCompleted={() => router.refresh()}
      />
    </div>
  );
}
