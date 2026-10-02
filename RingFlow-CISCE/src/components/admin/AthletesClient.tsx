"use client";

import React, { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { addAthlete, deleteAthlete, bulkAddMasterAthletes, updateAthleteCategory } from "@/actions/athletes";
import { importOfficialRoster } from "@/actions/officialImport";
import { matchesCategorySearch } from "@/lib/searchUtils";
import * as XLSX from "xlsx";

type Athlete = {
  id: string;
  name: string;
  chest_number: string | null;
  category_id: string | null;
  categories?: { name: string };
  school?: string | null;
  school_code?: string | null;
  sports_id?: string | null;
  dojo?: string | null;
  /** The pool this athlete is drawn into, when their category's draw has pools. */
  pool?: { label: string; tatami: string | null } | null;
};

type Category = {
  id: string;
  name: string;
};

interface Props {
  tournamentId: string;
  initialAthletes: Athlete[];
  categories: Category[];
  readOnly?: boolean;
}

export default function AthletesClient({ 
  tournamentId, 
  initialAthletes, 
  categories,
  readOnly = false,
}: Props) {
  const [athletes, setAthletes] = useState<Athlete[]>(initialAthletes);
  const [isAdding, setIsAdding] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters and Editing State with reload persistence
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("all");
  const [filterPool, setFilterPool] = useState("all");
  const [isFilterLoaded, setIsFilterLoaded] = useState(false);
  const [editingAthleteId, setEditingAthleteId] = useState<string | null>(null);

  // Preview State
  const [previewAthletes, setPreviewAthletes] = useState<any[]>([]);

  const [addForm, setAddForm] = useState({
    name: "",
    chest_number: "",
    category_id: "auto",
    school: "",
    school_code: "",
    sports_id: "",
    sex: "",
    age: "",
    weight: "",
    belt: "",
  });
  const [isSavingAthlete, setIsSavingAthlete] = useState(false);

  const searchParams = useSearchParams();

  // Sync props
  useEffect(() => {
    setAthletes(initialAthletes);
  }, [initialAthletes]);

  // Restore filters on mount from URL search params or sessionStorage so reloads preserve them
  useEffect(() => {
    const urlQ = searchParams.get("q");
    const urlCat = searchParams.get("category");

    const savedQ = typeof window !== "undefined" ? sessionStorage.getItem(`ringflow_athletes_q_${tournamentId}`) : null;
    const savedCat = typeof window !== "undefined" ? sessionStorage.getItem(`ringflow_athletes_cat_${tournamentId}`) : null;

    const initialQ = urlQ ?? savedQ ?? "";
    const initialCat = urlCat ?? savedCat ?? "all";

    if (initialQ) setSearchQuery(initialQ);
    if (initialCat) setFilterCategoryId(initialCat);
    setIsFilterLoaded(true);
  }, [searchParams, tournamentId]);

  // Persist filter changes to URL and sessionStorage
  useEffect(() => {
    if (!isFilterLoaded) return;

    if (typeof window !== "undefined") {
      if (searchQuery.trim()) {
        sessionStorage.setItem(`ringflow_athletes_q_${tournamentId}`, searchQuery);
      } else {
        sessionStorage.removeItem(`ringflow_athletes_q_${tournamentId}`);
      }

      if (filterCategoryId && filterCategoryId !== "all") {
        sessionStorage.setItem(`ringflow_athletes_cat_${tournamentId}`, filterCategoryId);
      } else {
        sessionStorage.removeItem(`ringflow_athletes_cat_${tournamentId}`);
      }

      const url = new URL(window.location.href);
      if (searchQuery.trim()) {
        url.searchParams.set("q", searchQuery.trim());
      } else {
        url.searchParams.delete("q");
      }

      if (filterCategoryId && filterCategoryId !== "all") {
        url.searchParams.set("category", filterCategoryId);
      } else {
        url.searchParams.delete("category");
      }

      window.history.replaceState(null, "", url.toString());
    }
  }, [searchQuery, filterCategoryId, isFilterLoaded, tournamentId]);

  const hasActiveFilters = Boolean(searchQuery.trim() || (filterCategoryId && filterCategoryId !== "all"));

  const handleClearFilters = () => {
    setSearchQuery("");
    setFilterCategoryId("all");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(`ringflow_athletes_q_${tournamentId}`);
      sessionStorage.removeItem(`ringflow_athletes_cat_${tournamentId}`);
      const url = new URL(window.location.href);
      url.searchParams.delete("q");
      url.searchParams.delete("category");
      window.history.replaceState(null, "", url.toString());
    }
  };

  const filteredAthletes = React.useMemo(() => {
    return athletes.filter((athlete) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = athlete.name.toLowerCase().includes(query);
        const cleanChestQ = query.replace(/^#/, "").trim();
        const isNumericChest = /^\d+$/.test(cleanChestQ);
        const matchesChest = isNumericChest
          ? athlete.chest_number?.toLowerCase() === cleanChestQ
          : athlete.chest_number?.toLowerCase().includes(cleanChestQ);
        const matchesSchool = (athlete.school || athlete.dojo)?.toLowerCase().includes(query);
        const matchesSportsId = athlete.sports_id?.toLowerCase().includes(query);
        const matchesCategory = matchesCategorySearch(
          athlete.categories?.name,
          searchQuery
        );
        const matchesPool = Boolean(athlete.pool && `${athlete.pool.label} ${athlete.pool.tatami ?? ""}`.toLowerCase().includes(query));
        if (!matchesName && !matchesChest && !matchesSchool && !matchesSportsId && !matchesCategory && !matchesPool) {
          return false;
        }
      }
      if (filterCategoryId !== "all") {
        if (filterCategoryId === "uncategorized") {
          if (athlete.category_id !== null && athlete.category_id !== "") return false;
        } else {
          if (athlete.category_id !== filterCategoryId) return false;
        }
      }
      if (filterPool !== "all" && athlete.pool?.label !== filterPool) return false;
      return true;
    });
  }, [athletes, searchQuery, filterCategoryId, filterPool]);

  // The pools of the category being looked at, to filter the roster by pool.
  const poolOptions = React.useMemo(() => {
    if (filterCategoryId === "all" || filterCategoryId === "uncategorized") return [];
    const labels = new Set<string>();
    for (const athlete of athletes) {
      if (athlete.category_id === filterCategoryId && athlete.pool) labels.add(athlete.pool.label);
    }
    return Array.from(labels).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [athletes, filterCategoryId]);

  const handleSaveAdd = async () => {
    if (!addForm.name.trim()) return alert("Athlete name is required");
    setIsSavingAthlete(true);
    try {
      await addAthlete(tournamentId, addForm);
      setIsAdding(false);
      setAddForm({
        name: "",
        chest_number: "",
        category_id: "auto",
        school: "",
        school_code: "",
        sports_id: "",
        sex: "",
        age: "",
        weight: "",
        belt: "",
      });
    } catch (err) {
      alert("Failed to add athlete: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingAthlete(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this athlete?")) return;
    try {
      await deleteAthlete(id, tournamentId);
    } catch (err) {
      alert("Failed to delete athlete");
    }
  };

  const handleUpdateCategory = async (athleteId: string, newCategoryId: string) => {
    try {
      await updateAthleteCategory(athleteId, newCategoryId === "uncategorized" ? null : newCategoryId, tournamentId);
      setEditingAthleteId(null);
    } catch (err) {
      alert("Failed to update category");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    
    try {
      const file = files[0];
      setUploadProgress(`Processing ${file.name}...`);
      
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet) as any[];

      // Expected columns: Number, School, School Code, SPORTS ID, Name, category, age, sex
      const parsedAthletes = json.map(row => {
        const no = String(row.Number || row.number || row.no || row.No || row.chest_number || "");
        const school = String(row.School || row.school || row.dojo || row.Dojo || row.club || "");
        const schoolCode = String(row["School Code"] || row.school_code || row.SchoolCode || "");
        const sportsId = String(row["SPORTS ID"] || row.sports_id || row.SportsId || "");
        const name = String(row.Name || row.name || row.athlete || "Unknown");
        const category = String(row.category || row.Category || "");
        const age = String(row.age || row.Age || "");
        const sex = String(row.sex || row.Sex || row.gender || "");
        const belt = String(row.belt || row.Belt || "");
        const day = String(row.day || row.Day || "");
        const weight = row.weight ?? row.Weight ?? row["weight (kg)"] ?? row["Weight (kg)"] ?? row.wt ?? null;
        const kata = row.kata ?? row.Kata ?? row.KATA ?? null;
        const kumite = row.kumite ?? row.Kumite ?? row.KUMITE ?? null;
        const teamKata = row.teamKata ?? row["Team Kata"] ?? row.team_kata ?? null;
        const teamKumite = row.teamKumite ?? row["Team Kumite"] ?? row.team_kumite ?? null;

        return {
          no,
          name,
          sex,
          belt,
          age,
          weight,
          kata,
          kumite,
          teamKata,
          teamKumite,
          dojo: school, // Map school to dojo for compatibility
          school,
          school_code: schoolCode,
          sports_id: sportsId,
          category,
          day
        };
      }).filter(a => a.name !== "Unknown");

      if (parsedAthletes.length > 0) {
        setPreviewAthletes(parsedAthletes);
      } else {
        alert("No valid athletes found in the file.");
      }
      
    } catch (err) {
      console.error(err);
      alert("Error parsing Master Excel file.");
    } finally {
      setIsUploading(false);
      setUploadProgress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleApproveUpload = async () => {
    setIsUploading(true);
    setUploadProgress("Pushing to database & determining categories...");
    try {
      const isOfficialFormat = previewAthletes.some(
        (a) => a.weight != null || a.kata != null || a.kumite != null
      );

      if (isOfficialFormat) {
        const res = await importOfficialRoster(
          tournamentId,
          previewAthletes.map((a) => ({
            name: a.name,
            chestNumber: a.no,
            school: a.school,
            schoolCode: a.school_code,
            sportsId: a.sports_id,
            belt: a.belt,
            age: a.age,
            sex: a.sex,
            weight: a.weight,
            kata: a.kata,
            kumite: a.kumite,
            teamKata: a.teamKata,
            teamKumite: a.teamKumite,
          }))
        );

        let msg = `Official Roster Import Successful!\n- Total Athletes: ${res.totalAthletes}\n- Kumite Entries: ${res.kumiteEntriesCreated}\n- Kata Entries: ${res.kataEntriesCreated}`;
        if (res.uncategorized.length > 0) {
          msg += `\n\nNotice: ${res.uncategorized.length} athlete(s) could not be matched to a category:\n` +
            res.uncategorized.slice(0, 5).map((u) => `• ${u.name}: ${u.reason}`).join("\n");
        }
        alert(msg);
      } else {
        await bulkAddMasterAthletes(tournamentId, previewAthletes);
        alert("Athletes imported successfully!");
      }

      setPreviewAthletes([]);
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert("Error saving to database: " + (err as Error).message);
    } finally {
      setIsUploading(false);
      setUploadProgress("");
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 sm:space-y-8 bg-surface pb-24 w-full">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-headline-sm text-headline-sm text-primary">Athlete Roster</h2>
          <p className="text-body-sm text-on-surface-variant">Manage athletes or drag-and-drop Excel files to bulk upload by category.</p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2 sm:gap-4">
            <input 
              type="file" 
              accept=".xlsx, .xls, .csv" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isAdding}
              className="px-4 py-2 border border-outline text-primary font-label-caps text-label-caps rounded flex items-center gap-2 hover:bg-surface-container-low disabled:opacity-50 text-xs"
            >
              <span className="material-symbols-outlined text-[18px]">upload</span> {isUploading ? "UPLOADING..." : "MASTER EXCEL UPLOAD"}
            </button>
            <button  
              onClick={() => setIsAdding(true)}
              disabled={isAdding || isUploading || categories.length === 0}
              title={categories.length === 0 ? "Add a category first" : ""}
              className="px-4 py-2 bg-primary text-white font-label-caps text-label-caps rounded flex items-center gap-2 hover:opacity-90 disabled:opacity-50 text-xs"
            >
              <span className="material-symbols-outlined text-[18px]">person_add</span> ADD ATHLETE
            </button>
          </div>
        )}
      </div>

      {uploadProgress && (
        <div className="bg-secondary-container text-on-secondary-container p-4 rounded-lg flex items-center gap-3 font-data-mono text-sm shadow-sm animate-pulse">
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" /> {uploadProgress}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 mb-3">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400 pointer-events-none">
            search
          </span>
          <input 
            type="text" 
            placeholder="Search by athlete, chest no, or category (e.g. u14_30-35kg, 30)..."
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

        <select 
          value={filterCategoryId}
          onChange={(e) => {
            setFilterCategoryId(e.target.value);
            setFilterPool("all");
          }}
          className={`w-full sm:w-64 bg-[#FAF9F5] border rounded-lg p-2 text-sm outline-none transition-all shadow-2xs cursor-pointer ${
            filterCategoryId !== "all"
              ? "border-[#0E9C7C] ring-2 ring-[#0E9C7C]/20 font-semibold text-[#0B7C63]"
              : "border-outline-variant focus:border-[#0E9C7C]"
          }`}
        >
          <option value="all">All Categories</option>
          <option value="uncategorized">Uncategorized</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {poolOptions.length > 0 && (
          <select
            value={filterPool}
            onChange={(e) => setFilterPool(e.target.value)}
            aria-label="Filter by pool"
            className={`w-full sm:w-40 bg-[#FAF9F5] border rounded-lg p-2 text-sm outline-none transition-all shadow-2xs cursor-pointer ${
              filterPool !== "all" ? "border-[#0E9C7C] ring-2 ring-[#0E9C7C]/20 font-semibold text-[#0B7C63]" : "border-outline-variant focus:border-[#0E9C7C]"
            }`}
          >
            <option value="all">All pools</option>
            {poolOptions.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        )}

        {/* ─── Highlighted Clear Filters Button ─── */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="group flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-[0_0_16px_rgba(5,150,105,0.4)] hover:shadow-[0_0_24px_rgba(5,150,105,0.65)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 cursor-pointer shrink-0 animate-in fade-in zoom-in-95"
            title="Filters are active. Click to clear and view all athletes."
          >
            <span className="material-symbols-outlined text-[16px] group-hover:rotate-90 transition-transform duration-200">
              filter_alt_off
            </span>
            <span className="tracking-wide uppercase">Clear Filters</span>
          </button>
        )}
      </div>

      {/* ─── Active Filter Notification Banner ─── */}
      {hasActiveFilters && (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 mb-3 animate-in fade-in">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold flex items-center gap-1 text-[#0B7C63]">
              <span className="w-2 h-2 rounded-full bg-[#0E9C7C] animate-pulse" />
              Active Filter:
            </span>
            <span className="text-slate-600">
              Showing <strong>{filteredAthletes.length}</strong> of <strong>{athletes.length}</strong> athletes
            </span>
            {searchQuery.trim() && (
              <span className="px-2 py-0.5 rounded-md bg-[#FAF9F5] border border-emerald-200 text-[#0B7C63] font-medium flex items-center gap-1">
                Query: &ldquo;{searchQuery}&rdquo;
                <button type="button" onClick={() => setSearchQuery("")} className="hover:text-red-500 cursor-pointer text-xs">×</button>
              </span>
            )}
            {filterCategoryId !== "all" && (
              <span className="px-2 py-0.5 rounded-md bg-[#FAF9F5] border border-emerald-200 text-[#0B7C63] font-medium flex items-center gap-1">
                Category: {categories.find(c => c.id === filterCategoryId)?.name || "Uncategorized"}
                <button type="button" onClick={() => setFilterCategoryId("all")} className="hover:text-red-500 cursor-pointer text-xs">×</button>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-[11px] font-bold text-[#0B7C63] hover:text-emerald-800 underline shrink-0 cursor-pointer"
          >
            Clear all to view all
          </button>
        </div>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead className="bg-surface-container-low border-b border-outline-variant">
            <tr>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant w-24">Chest No.</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Name</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">School</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant w-28">School Code</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant w-32">Sports ID</th>
              <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Category</th>
              {!readOnly && (
                <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant text-right">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="font-body-sm text-body-sm divide-y divide-outline-variant">

            {filteredAthletes.map((athlete) => (
              <tr key={athlete.id} className="hover:bg-surface-container-low transition-colors">
                <td className="px-6 py-4 font-data-mono">{athlete.chest_number || "-"}</td>
                <td className="px-6 py-4 font-bold text-primary">
                  {athlete.name}
                  {athlete.pool && (
                    <span
                      className="ml-2 align-middle px-1.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded text-[10px] font-bold whitespace-nowrap"
                      title={athlete.pool.tatami ? `${athlete.pool.label} runs on ${athlete.pool.tatami}` : athlete.pool.label}
                    >
                      {athlete.pool.label}
                      {athlete.pool.tatami ? ` · ${athlete.pool.tatami}` : ""}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">{athlete.school || athlete.dojo || "-"}</td>
                <td className="px-6 py-4 font-data-mono">{athlete.school_code || "-"}</td>
                <td className="px-6 py-4 font-data-mono">{athlete.sports_id || "-"}</td>
                <td className="px-6 py-4">
                  {readOnly ? (
                    athlete.categories?.name ? (
                      <span className="px-2 py-1 bg-surface-container rounded text-xs font-label-caps">{athlete.categories.name}</span>
                    ) : (
                      <span className="px-2 py-1 bg-error/10 text-error rounded text-xs font-label-caps">UNCATEGORIZED</span>
                    )
                  ) : editingAthleteId === athlete.id ? (
                    <select 
                      defaultValue={athlete.category_id || "uncategorized"}
                      onChange={(e) => handleUpdateCategory(athlete.id, e.target.value)}
                      onBlur={() => setEditingAthleteId(null)}
                      autoFocus
                      className="w-full bg-[#FAF9F5] border border-outline-variant rounded p-1 text-xs outline-none"
                    >
                      <option value="uncategorized">UNCATEGORIZED</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  ) : (
                    <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setEditingAthleteId(athlete.id)}>
                      {athlete.categories?.name ? (
                        <span className="px-2 py-1 bg-surface-container rounded text-xs font-label-caps hover:bg-surface-container-high transition-colors">{athlete.categories.name}</span>
                      ) : (
                        <span className="px-2 py-1 bg-error/10 text-error rounded text-xs font-label-caps hover:bg-error/20 transition-colors">UNCATEGORIZED</span>
                      )}
                      <span className="material-symbols-outlined text-[14px] text-outline opacity-0 group-hover:opacity-100 transition-opacity">edit</span>
                    </div>
                  )}
                </td>
                {!readOnly && (
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => handleDelete(athlete.id)} className="material-symbols-outlined text-outline hover:text-error transition-colors text-sm cursor-pointer">delete</button>
                  </td>
                )}
              </tr>
            ))}
            
            {/* Empty state when filters return 0 results */}
            {filteredAthletes.length === 0 && !isAdding && (
              <tr>
                <td colSpan={readOnly ? 6 : 7} className="px-6 py-12 text-center">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-[#0E9C7C]">
                      <span className="material-symbols-outlined text-[26px]">filter_alt_off</span>
                    </div>
                    <div className="text-[#0F172A] font-semibold text-[15px]">
                      {hasActiveFilters ? "No athletes match your active filters" : "No athletes found in this tournament roster."}
                    </div>
                    {hasActiveFilters && (
                      <>
                        <p className="text-xs text-slate-500 max-w-sm">
                          Try adjusting your search query or clear the filters to view the complete roster.
                        </p>
                        <button
                          type="button"
                          onClick={handleClearFilters}
                          className="mt-1 px-4 py-2 rounded-lg bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-bold text-xs shadow-[0_0_12px_rgba(14,156,124,0.3)] hover:shadow-lg transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-[16px]">filter_alt_off</span>
                          Clear Filters to View All ({athletes.length})
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Preview Modal */}
      {previewAthletes.length > 0 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest w-full max-w-4xl max-h-[80vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface-container-low shrink-0">
              <div>
                <h2 className="text-xl font-bold text-primary mb-1">Preview Master Roster</h2>
                <p className="text-xs text-on-surface-variant">Review the {previewAthletes.length} athletes extracted from your Excel file.</p>
              </div>
              <button onClick={() => setPreviewAthletes([])} className="material-symbols-outlined text-outline hover:text-error transition-colors">close</button>
            </div>
            
            <div className="flex-1 overflow-auto p-6 bg-surface-container-lowest">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant text-[10px] font-label-caps text-on-surface-variant uppercase tracking-wider">
                    <th className="py-2">No</th>
                    <th className="py-2">Name</th>
                    <th className="py-2">School</th>
                    <th className="py-2">School Code</th>
                    <th className="py-2">Sports ID</th>
                    <th className="py-2">Age</th>
                    <th className="py-2">Sex</th>
                    <th className="py-2">Category</th>
                  </tr>
                </thead>
                <tbody className="text-sm font-body-md text-on-surface">
                  {previewAthletes.map((a, i) => (
                    <tr key={i} className="border-b border-outline-variant/30 hover:bg-surface-container-highest/30 transition-colors">
                      <td className="py-2 font-data-mono text-outline">{a.no || "-"}</td>
                      <td className="py-2 font-bold text-primary">{a.name}</td>
                      <td className="py-2">{a.school || "-"}</td>
                      <td className="py-2 font-data-mono">{a.school_code || "-"}</td>
                      <td className="py-2 font-data-mono">{a.sports_id || "-"}</td>
                      <td className="py-2 font-data-mono">{a.age || "-"}</td>
                      <td className="py-2">{a.sex || "-"}</td>
                      <td className="py-2">{a.category || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-6 border-t border-outline-variant bg-surface-container-low flex justify-between items-center shrink-0">
              <button 
                onClick={() => setPreviewAthletes([])}
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
                {isUploading ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" /> {uploadProgress || "PUSHING..."}</> : "APPROVE & UPLOAD"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Add Athlete Modal ────────────────────────────── */}
      {isAdding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-outline-variant px-6 py-4 bg-surface-container-low">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#0E9C7C]">person_add</span>
                <h3 className="text-base font-bold text-primary">Add New Athlete</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="text-outline hover:text-on-surface cursor-pointer p-1"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Category Hint Banner */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 flex items-start gap-2.5">
                <span className="material-symbols-outlined text-emerald-700 text-lg shrink-0 mt-0.5">info</span>
                <div>
                  <div className="font-bold text-[#0B7C63] mb-0.5">Category Assignment Logic</div>
                  <p className="text-slate-600 leading-relaxed">
                    Leave category as <strong>Auto-Assign</strong> to automatically match based on <strong>Gender</strong>, <strong>Age</strong>, and <strong>Belt</strong>. If criteria are missing or unmatched, the athlete will be safely placed in <strong>Uncategorized</strong>.
                  </p>
                </div>
              </div>

              {/* Form Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Full Name */}
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. John Doe"
                    value={addForm.name}
                    onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none"
                  />
                </div>

                {/* Chest Number */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    Chest / Bib No.
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 104"
                    value={addForm.chest_number}
                    onChange={(e) => setAddForm({ ...addForm, chest_number: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm font-data-mono text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none"
                  />
                </div>

                {/* Category Selection */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    Target Category
                  </label>
                  <select
                    value={addForm.category_id}
                    onChange={(e) => setAddForm({ ...addForm, category_id: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none cursor-pointer"
                  >
                    <option value="auto">✨ Auto-Assign (by Age / Gender / Belt)</option>
                    <option value="uncategorized">Uncategorized (Assign Later)</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Gender */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    Gender / Sex
                  </label>
                  <select
                    value={addForm.sex}
                    onChange={(e) => setAddForm({ ...addForm, sex: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none cursor-pointer"
                  >
                    <option value="">Not Specified</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>

                {/* Age */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    Age
                  </label>
                  <input
                    type="number"
                    min="4"
                    max="99"
                    placeholder="e.g. 14"
                    value={addForm.age}
                    onChange={(e) => setAddForm({ ...addForm, age: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm font-data-mono text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none"
                  />
                </div>

                {/* Weight */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    Weight (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 48.5"
                    value={addForm.weight}
                    onChange={(e) => setAddForm({ ...addForm, weight: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm font-data-mono text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none"
                  />
                </div>

                {/* Belt */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    Belt / Rank
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Black, Brown, Yellow"
                    value={addForm.belt}
                    onChange={(e) => setAddForm({ ...addForm, belt: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none"
                  />
                </div>

                {/* School / Club */}
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    School / Dojo / Club
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. St. Joseph Academy"
                    value={addForm.school}
                    onChange={(e) => setAddForm({ ...addForm, school: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none"
                  />
                </div>

                {/* School Code */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    School Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. SJA-01"
                    value={addForm.school_code}
                    onChange={(e) => setAddForm({ ...addForm, school_code: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm font-data-mono text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none"
                  />
                </div>

                {/* Sports ID */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-on-surface">
                    Sports ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. SP-9982"
                    value={addForm.sports_id}
                    onChange={(e) => setAddForm({ ...addForm, sports_id: e.target.value })}
                    className="w-full rounded-lg border border-outline-variant bg-[#FAF9F5] px-3 py-2 text-sm font-data-mono text-primary focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-outline-variant px-6 py-3.5 bg-surface-container-low">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                disabled={isSavingAthlete}
                className="px-4 py-2 text-xs font-bold text-outline hover:text-on-surface rounded-lg hover:bg-surface-container transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAdd}
                disabled={isSavingAthlete || !addForm.name.trim()}
                className="px-5 py-2 text-xs font-bold text-white bg-[#0E9C7C] hover:bg-[#0B7C63] rounded-lg shadow-sm transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {isSavingAthlete ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-base">check</span>
                    Save Athlete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
