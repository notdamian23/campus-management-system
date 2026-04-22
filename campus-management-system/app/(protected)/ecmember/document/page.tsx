"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  type StorageReference,
  type UploadTaskSnapshot,
  uploadBytesResumable,
} from "firebase/storage";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from "@heroui/dropdown";
import { Input } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { Progress } from "@heroui/progress";
import { Select, SelectItem } from "@heroui/select";
import {
  type CampusTableColumn,
  CampusTableBodySkeleton,
} from "@/components/ui";
import { FileStack, FolderKanban, HardDriveUpload, Upload } from "lucide-react";
import {
  ECDataTable,
  ECDocumentDetailsDrawer,
  ECDocumentDetailsPanel,
  ECFilterBar,
  ECPageHeader,
  ECStatsGrid,
  type ECStatItem,
  useECPageErrorToast,
  useIsBelowBreakpoint,
} from "@/components/ecmember";
import { createCampusLogger } from "@/lib/campus-logger";
import type { CampusProfileDoc } from "@/lib/campus-auth";
import {
  canManageDocument,
  canViewDocument,
  getCourseScope,
  isBOD,
} from "@/lib/ec-permissions";
import {
  createCampusDocumentMetadata,
  deleteCampusDocument,
  getCampusDocumentDownloadUrl,
} from "@/lib/firebase-functions";
import { auth, db, storage } from "@/lib/firebase";
import { normalizeCourse, normalizeCourseSlug } from "@/lib/courseOptions";
import { campusToast } from "@/lib/toast";

type DocType = "PDF" | "Images" | "Word Files" | "Spreadsheets";
type DocCategory = "Events" | "Payments" | "Clearance" | "General";

const ONE_MB_IN_BYTES = 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 10 * ONE_MB_IN_BYTES;
const MEMBER_STORAGE_LIMIT_BYTES = 1024 * ONE_MB_IN_BYTES;
const UPLOAD_TIMEOUT_MS = 60_000;
const FETCH_URL_TIMEOUT_MS = 20_000;
const WRITE_DOC_TIMEOUT_MS = 20_000;
const CLEANUP_TIMEOUT_MS = 15_000;

const BLOCKED_EXTENSIONS = new Set(["mp4", "exe", "zip"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const WORD_EXTENSIONS = new Set(["doc", "docx"]);
const EXCEL_EXTENSIONS = new Set(["xls", "xlsx", "csv"]);
const ACCEPTED_FILE_TYPES =
  ".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.csv";

const DOC_TYPES: DocType[] = ["PDF", "Images", "Word Files", "Spreadsheets"];
const DOC_CATEGORIES: DocCategory[] = [
  "Events",
  "Payments",
  "Clearance",
  "General",
];
const ecDocumentsLogger = createCampusLogger("EC Documents");

type FirestoreTimestampLike = { toMillis?: () => number; seconds?: number };

type FirestoreDocumentRecord = {
  name?: string;
  type?: string;
  category?: string;
  sizeBytes?: number;
  downloadURL?: string;
  storagePath?: string;
  ownerType?: "ec" | "bod";
  courseScope?: string | null;
  createdByCourseScope?: string | null;
  createdBy?: string;
  createdByUid?: string;
  ownerUid?: string;
  uploadedByUid?: string;
  createdAt?: FirestoreTimestampLike | string | number | null;
};

type DocumentItem = {
  id: string;
  name: string;
  type: DocType;
  category: DocCategory;
  sizeBytes: number;
  uploadedAt: string;
  createdAtMs: number;
  downloadUrl: string;
  storagePath: string;
  ownerType: "ec" | "bod";
  courseScope: string | null;
  createdByCourseScope: string | null;
  createdBy: string;
  uploadedByUid: string;
};

type ViewerProfile = CampusProfileDoc & {
  uid: string;
};

type SortMode = "latest_to_oldest" | "oldest_to_latest" | "alphabetical";

const documentColumns: CampusTableColumn<DocumentItem>[] = [
  { key: "name", label: "Document" },
  { key: "type", label: "Type" },
  { key: "category", label: "Category" },
  { key: "size", label: "Size" },
  { key: "uploadedAt", label: "Uploaded" },
  { key: "actions", label: "Actions" },
];

const toMillis = (value: FirestoreDocumentRecord["createdAt"]): number => {
  if (
    value &&
    typeof value === "object" &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  if (value && typeof value === "object" && typeof value.seconds === "number") {
    return Number(value.seconds) * 1000;
  }

  const parsed = new Date(value as string | number).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const toDateInputString = (ms: number): string => {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const getFileExtension = (filename: string) => {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return "";
  return filename.slice(lastDot + 1).toLowerCase();
};

const inferDocType = (filename: string): DocType | null => {
  const ext = getFileExtension(filename);
  if (IMAGE_EXTENSIONS.has(ext)) return "Images";
  if (PDF_EXTENSIONS.has(ext)) return "PDF";
  if (WORD_EXTENSIONS.has(ext)) return "Word Files";
  if (EXCEL_EXTENSIONS.has(ext)) return "Spreadsheets";
  return null;
};

const normalizeDocType = (
  rawType: string | undefined,
  filename: string,
): DocType => {
  if (rawType && DOC_TYPES.includes(rawType as DocType)) {
    return rawType as DocType;
  }
  return inferDocType(filename) ?? "PDF";
};

const normalizeDocCategory = (rawCategory: string | undefined): DocCategory => {
  if (rawCategory && DOC_CATEGORIES.includes(rawCategory as DocCategory)) {
    return rawCategory as DocCategory;
  }
  return "General";
};

const mapFirestoreDocumentItem = (
  snapshot: { id: string; data: () => FirestoreDocumentRecord },
): DocumentItem => {
  const data = snapshot.data() as FirestoreDocumentRecord;
  const name = String(data.name ?? "Untitled");
  const createdAtMs = toMillis(data.createdAt);

  return {
    id: snapshot.id,
    name,
    type: normalizeDocType(data.type, name),
    category: normalizeDocCategory(data.category),
    sizeBytes: Number(data.sizeBytes ?? 0),
    uploadedAt: createdAtMs ? toDateInputString(createdAtMs) : "",
    createdAtMs,
    downloadUrl: String(data.downloadURL ?? ""),
    storagePath: String(data.storagePath ?? ""),
    ownerType: data.ownerType === "bod" ? "bod" : "ec",
    courseScope: typeof data.courseScope === "string" ? data.courseScope : null,
    createdByCourseScope:
      typeof data.createdByCourseScope === "string"
        ? data.createdByCourseScope
        : null,
    createdBy: String(data.createdBy ?? data.createdByUid ?? data.ownerUid ?? ""),
    uploadedByUid: String(data.uploadedByUid ?? data.createdByUid ?? ""),
  };
};

const sortDocumentItems = (items: DocumentItem[]) =>
  [...items].sort(
    (left, right) =>
      Number(right.createdAtMs ?? 0) - Number(left.createdAtMs ?? 0) ||
      left.name.localeCompare(right.name),
  );

const addToast = ({
  title,
  description,
  color = "primary",
  timeout,
}: {
  title: string;
  description: string;
  color?:
    | "success"
    | "danger"
    | "warning"
    | "primary"
    | "secondary"
    | "default";
  timeout?: number;
}) => {
  const tone =
    color === "success"
      ? "success"
      : color === "warning"
        ? "warning"
        : color === "danger"
          ? "error"
          : "info";

  campusToast.show({
    title,
    description,
    tone,
    timeout,
    dedupeKey: `ec-documents:${color}:${title}:${description}`,
  });
};

const toErrorCode = (error: unknown): string => {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "unknown";
};

const toServerResponse = (error: unknown): string => {
  if (
    error &&
    typeof error === "object" &&
    "serverResponse" in error &&
    typeof (error as { serverResponse?: unknown }).serverResponse === "string"
  ) {
    return (error as { serverResponse: string }).serverResponse;
  }
  return "";
};

const toErrorMessage = (error: unknown): string => {
  const serverResponse = toServerResponse(error);
  if (serverResponse) {
    try {
      const parsed = JSON.parse(serverResponse) as {
        error?: { message?: string };
      };
      if (parsed?.error?.message) return parsed.error.message;
    } catch {
      // Ignore JSON parse errors and fall back to generic message extraction.
    }
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  if (typeof error === "string") return error;
  return "Unknown error";
};

const toScopedUploadErrorMessage = (
  error: unknown,
  viewerCourseScope: string | null,
  viewerIsBod: boolean,
): string => {
  const code = toErrorCode(error).toLowerCase();
  const message = toErrorMessage(error);
  const lowered = message.toLowerCase();

  if (!viewerIsBod) {
    return message;
  }

  if (!viewerCourseScope) {
    return "B.O.D course scope is missing. Ask admin to update your account.";
  }

  if (
    code.includes("storage/unauthorized") ||
    code.includes("unauthorized") ||
    lowered.includes("permission-denied") ||
    lowered.includes("missing or insufficient permissions")
  ) {
    return "Upload path is outside your B.O.D course scope.";
  }

  return message;
};

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`${label} timed out after ${Math.floor(timeoutMs / 1000)}s.`),
      );
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

const uploadWithTimeout = async (
  storageRef: StorageReference,
  file: File,
  timeoutMs: number,
): Promise<UploadTaskSnapshot> => {
  return await new Promise<UploadTaskSnapshot>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || undefined,
    });

    const timer = setTimeout(() => {
      task.cancel();
      reject(
        new Error(`Upload timed out after ${Math.floor(timeoutMs / 1000)}s.`),
      );
    }, timeoutMs);

    task.on(
      "state_changed",
      undefined,
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
      () => {
        clearTimeout(timer);
        resolve(task.snapshot);
      },
    );
  });
};

export default function DocumentsPage() {
  const isCompactViewport = useIsBelowBreakpoint(1280);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [activeUid, setActiveUid] = useState<string | null>(null);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(null);
  const [viewerProfileReady, setViewerProfileReady] = useState(false);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [documentDrawerOpen, setDocumentDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<DocType | "All Types">(
    "All Types",
  );
  const [categoryFilter, setCategoryFilter] = useState<
    DocCategory | "All Categories"
  >("All Categories");
  const [documentSortMode, setDocumentSortMode] =
    useState<SortMode>("latest_to_oldest");

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<DocCategory>("General");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [pendingDeleteDocument, setPendingDeleteDocument] =
    useState<DocumentItem | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [downloadSubmittingId, setDownloadSubmittingId] = useState<
    string | null
  >(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const viewerIsBod = useMemo(() => isBOD(viewerProfile), [viewerProfile]);
  const viewerCourseScope = useMemo(
    () => getCourseScope(viewerProfile),
    [viewerProfile],
  );
  const viewerCourseScopeValue = useMemo(
    () => normalizeCourse(viewerCourseScope ?? ""),
    [viewerCourseScope],
  );
  const viewerCourseScopeSlug = useMemo(
    () => normalizeCourseSlug(viewerCourseScopeValue),
    [viewerCourseScopeValue],
  );

  const loadDocuments = useCallback(async () => {
    if (!authReady || !viewerProfileReady) {
      return;
    }

    if (!activeUid) {
      setDocuments([]);
      setDocumentsLoading(false);
      setDocumentsError("User session not found.");
      return;
    }

    if (viewerIsBod && !viewerCourseScopeValue) {
      setDocuments([]);
      setDocumentsLoading(false);
      setDocumentsError("B.O.D. course scope is missing.");
      return;
    }

    setDocumentsLoading(true);
    setDocumentsError("");

    const handleLoadError = (error: unknown, source: string) => {
      ecDocumentsLogger.error("Firestore fetch failed.", {
        uid: activeUid,
        source,
        code: toErrorCode(error),
        message: toErrorMessage(error),
        raw: error,
      });
      setDocuments([]);
      setDocumentsLoading(false);
      setDocumentsError("Failed to load documents from Firestore.");
    };

    try {
      if (viewerIsBod && viewerCourseScopeValue) {
        const [createdBySnap, createdByUidSnap] = await Promise.all([
          getDocs(
            query(collection(db, "ecDocuments"), where("createdBy", "==", activeUid)),
          ),
          getDocs(
            query(collection(db, "ecDocuments"), where("createdByUid", "==", activeUid)),
          ),
        ]);

        const mergedDocuments = new Map<string, DocumentItem>();
        [...createdBySnap.docs, ...createdByUidSnap.docs].forEach((snapshot) => {
          const item = mapFirestoreDocumentItem(snapshot);
          mergedDocuments.set(snapshot.id, item);
        });

        setDocuments(sortDocumentItems(Array.from(mergedDocuments.values())));
        setDocumentsLoading(false);
        return;
      }

      const allDocumentsSnap = await getDocs(
        query(collection(db, "ecDocuments"), orderBy("createdAt", "desc")),
      );
      setDocuments(sortDocumentItems(allDocumentsSnap.docs.map(mapFirestoreDocumentItem)));
      setDocumentsLoading(false);
    } catch (error) {
      handleLoadError(
        error,
        viewerIsBod && viewerCourseScopeValue ? "scopedDocuments" : "allDocuments",
      );
    }
  }, [
    activeUid,
    authReady,
    viewerCourseScopeValue,
    viewerIsBod,
    viewerProfileReady,
  ]);

  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;

      if (!user) {
        setActiveUid(null);
        setViewerProfile(null);
        setAuthReady(true);
        setViewerProfileReady(true);
        return;
      }

      setActiveUid(user.uid);

      try {
        const profileSnapshot = await getDoc(doc(db, "profiles", user.uid));
        if (!active) return;

        if (!profileSnapshot.exists()) {
          setViewerProfile({ uid: user.uid });
        } else {
          setViewerProfile({
            uid: user.uid,
            ...(profileSnapshot.data() as CampusProfileDoc),
          });
        }
      } catch {
        if (active) {
          setViewerProfile({ uid: user.uid });
        }
      } finally {
        if (active) {
          setAuthReady(true);
          setViewerProfileReady(true);
        }
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const scopedDocuments = useMemo(() => {
    return documents.filter((docItem) => canViewDocument(viewerProfile, docItem));
  }, [documents, viewerProfile]);

  useEffect(() => {
    if (scopedDocuments.length === 0) {
      setSelectedDocId(null);
      return;
    }

    if (!selectedDocId) {
      setSelectedDocId(scopedDocuments[0].id);
      return;
    }

    const stillExists = scopedDocuments.some(
      (docItem) => docItem.id === selectedDocId,
    );
    if (!stillExists) {
      setSelectedDocId(scopedDocuments[0].id);
    }
  }, [scopedDocuments, selectedDocId]);

  const filteredDocuments = useMemo(() => {
    return scopedDocuments.filter((docItem) => {
      const matchesSearch = docItem.name
        .toLowerCase()
        .includes(search.trim().toLowerCase());
      const matchesType =
        typeFilter === "All Types" || docItem.type === typeFilter;
      const matchesCategory =
        categoryFilter === "All Categories" ||
        docItem.category === categoryFilter;
      return matchesSearch && matchesType && matchesCategory;
    });
  }, [scopedDocuments, search, typeFilter, categoryFilter]);

  const sortedFilteredDocuments = useMemo(() => {
    const list = [...filteredDocuments];

    if (documentSortMode === "alphabetical") {
      list.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
      return list;
    }

    list.sort((a, b) => {
      const aMs = Number(a.createdAtMs ?? 0);
      const bMs = Number(b.createdAtMs ?? 0);
      return documentSortMode === "oldest_to_latest" ? aMs - bMs : bMs - aMs;
    });

    return list;
  }, [filteredDocuments, documentSortMode]);

  const documentSortLabel = useMemo(() => {
    if (documentSortMode === "oldest_to_latest") return "Date, old to new";
    if (documentSortMode === "alphabetical") return "Alphabetically, A-Z";
    return "Date, new to old";
  }, [documentSortMode]);

  const totalStorageBytes = useMemo(() => {
    return scopedDocuments.reduce((sum, docItem) => sum + docItem.sizeBytes, 0);
  }, [scopedDocuments]);

  const totalStorageMB = totalStorageBytes / ONE_MB_IN_BYTES;

  const recentUploads = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    return scopedDocuments.filter(
      (docItem) =>
        docItem.createdAtMs >= sevenDaysAgo && docItem.createdAtMs <= now,
    ).length;
  }, [scopedDocuments]);

  const selectedDocument = useMemo(() => {
    return scopedDocuments.find((docItem) => docItem.id === selectedDocId) ?? null;
  }, [scopedDocuments, selectedDocId]);

  const selectedDocumentCanDownload = useMemo(() => {
    return Boolean(
      selectedDocument &&
        canViewDocument(viewerProfile, selectedDocument) &&
        (selectedDocument.storagePath || selectedDocument.downloadUrl),
    );
  }, [selectedDocument, viewerProfile]);

  const selectedDocumentCanDelete = useMemo(() => {
    return Boolean(
      selectedDocument && canManageDocument(viewerProfile, selectedDocument),
    );
  }, [selectedDocument, viewerProfile]);

  useECPageErrorToast(documentsError || null, "documents");

  const storagePercent = Math.min(
    (totalStorageBytes / MEMBER_STORAGE_LIMIT_BYTES) * 100,
    100,
  );
  const formatMB = (bytes: number) => (bytes / ONE_MB_IN_BYTES).toFixed(2);
  const remainingStorageMB = Math.max(
    0,
    (MEMBER_STORAGE_LIMIT_BYTES - totalStorageBytes) / ONE_MB_IN_BYTES,
  );
  const documentSummaryItems = useMemo<ECStatItem[]>(
    () => [
      {
        label: "Total Documents",
        value: scopedDocuments.length,
        description: "All EC files in the shared library",
        tone: "blue",
        icon: FileStack,
      },
      {
        label: "Recent Uploads",
        value: recentUploads,
        description: "Files added in the last 7 days",
        tone: "green",
        icon: Upload,
      },
      {
        label: "Storage Used",
        value: `${totalStorageMB.toFixed(2)} MB`,
        description: "Current shared EC storage usage",
        tone: "amber",
        icon: HardDriveUpload,
      },
    ],
    [recentUploads, scopedDocuments.length, totalStorageMB],
  );

  const handleUploadClick = () => {
    if (!activeUid) {
      addToast({
        title: "Session not ready",
        description: "Please wait a moment and try again.",
        color: "warning",
        timeout: 5000,
      });
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setPendingFiles(Array.from(files));
    setUploadCategory("General");
    setUploadError("");
    setIsCategoryModalOpen(true);
    e.target.value = "";
  };

  const handleCancelUpload = () => {
    setPendingFiles([]);
    setUploadError("");
    setIsCategoryModalOpen(false);
  };

  const handleConfirmUpload = async () => {
    if (!activeUid) {
      setUploadError("Your session expired. Please log in again.");
      addToast({
        title: "Session expired",
        description: "Please log in again before uploading documents.",
        color: "danger",
        timeout: 6000,
      });
      return;
    }

    if (pendingFiles.length === 0) {
      setIsCategoryModalOpen(false);
      return;
    }

    if (viewerIsBod && (!viewerCourseScopeValue || !viewerCourseScopeSlug)) {
      setUploadError("B.O.D. course scope is missing. Please contact an administrator.");
      addToast({
        title: "Missing course scope",
        description: "B.O.D. uploads require an assigned course scope.",
        color: "danger",
        timeout: 6000,
      });
      return;
    }

    setUploading(true);
    setUploadError("");

    const uploadSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ecDocumentsLogger.info("Upload session started.", {
      uploadSessionId,
      uid: activeUid,
      fileCount: pendingFiles.length,
      category: uploadCategory,
    });

    try {
      const rejectedMessages: string[] = [];
      let nextTotalBytes = totalStorageBytes;
      let uploadedCount = 0;
      const bodStoragePrefix = viewerIsBod && viewerCourseScopeSlug
        ? `documents/course/${viewerCourseScopeSlug}`
        : "";

      if (viewerIsBod) {
        console.info("[DOCUMENT][BOD]", {
          uid: activeUid,
          role: String(viewerProfile?.role ?? "").trim(),
          profileCourseRaw: String(viewerProfile?.course ?? "").trim(),
          profileCourseScopeRaw: String(viewerProfile?.courseScope ?? "").trim(),
          profileAssignedCourseRaw: String(viewerProfile?.assignedCourse ?? "").trim(),
          bodScopeCanonical: viewerCourseScopeValue,
          selectedCategory: uploadCategory,
          generatedStoragePrefix: bodStoragePrefix,
          extractedCourseSlug: bodStoragePrefix.split("/")[2] ?? "",
        });
      }

      for (const file of pendingFiles) {
        const ext = getFileExtension(file.name);
        const docType = inferDocType(file.name);

        if (BLOCKED_EXTENSIONS.has(ext)) {
          rejectedMessages.push(`${file.name}: .${ext} files are not allowed.`);
          continue;
        }

        if (!docType) {
          rejectedMessages.push(
            `${file.name}: only Images, PDF, Excel, and Word files are allowed.`,
          );
          continue;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
          rejectedMessages.push(`${file.name}: exceeds 10 MB per-file limit.`);
          continue;
        }

        if (nextTotalBytes + file.size > MEMBER_STORAGE_LIMIT_BYTES) {
          rejectedMessages.push(
            `${file.name}: exceeds the 1 GB shared EC storage limit.`,
          );
          continue;
        }

        const docRef = doc(collection(db, "ecDocuments"));
        const storagePath = viewerIsBod && bodStoragePrefix
          ? `${bodStoragePrefix}/${docRef.id}/${file.name}`
          : `ec-documents/shared/${docRef.id}/${file.name}`;
        const storageRef = ref(storage, storagePath);

        try {
          ecDocumentsLogger.info("Uploading file.", {
            uploadSessionId,
            uid: activeUid,
            name: file.name,
            sizeBytes: file.size,
            storagePath,
          });

          const uploaded = await uploadWithTimeout(
            storageRef,
            file,
            UPLOAD_TIMEOUT_MS,
          );
          const downloadURL = await withTimeout(
            getDownloadURL(uploaded.ref),
            FETCH_URL_TIMEOUT_MS,
            "Get download URL",
          );

          await withTimeout(
            createCampusDocumentMetadata({
              docId: docRef.id,
              name: file.name,
              type: docType,
              category: uploadCategory,
              sizeBytes: file.size,
              downloadURL,
              storagePath,
            }),
            WRITE_DOC_TIMEOUT_MS,
            "Write Firestore metadata",
          );

          nextTotalBytes += file.size;
          uploadedCount += 1;

          ecDocumentsLogger.info("File uploaded successfully.", {
            uploadSessionId,
            uid: activeUid,
            name: file.name,
            storagePath,
            docId: docRef.id,
          });
        } catch (error) {
          const code = toErrorCode(error);
          const message = toScopedUploadErrorMessage(
            error,
            viewerCourseScope,
            viewerIsBod,
          );

          ecDocumentsLogger.error("File upload failed.", {
            uploadSessionId,
            uid: activeUid,
            name: file.name,
            storagePath,
            code,
            message,
            serverResponse: toServerResponse(error),
            raw: error,
          });

          rejectedMessages.push(`${file.name}: ${message}`);

          try {
            await withTimeout(
              deleteObject(storageRef),
              CLEANUP_TIMEOUT_MS,
              "Cleanup storage object",
            );
          } catch (cleanupError) {
            ecDocumentsLogger.warn("Failed to cleanup orphaned storage object.", {
              uploadSessionId,
              uid: activeUid,
              name: file.name,
              storagePath,
              code: toErrorCode(cleanupError),
              message: toErrorMessage(cleanupError),
              raw: cleanupError,
            });
          }
        }
      }

      if (uploadedCount === 0 && rejectedMessages.length === 0) {
        setUploadError("No files were uploaded.");
        addToast({
          title: "No files uploaded",
          description: "No valid files were found to upload.",
          color: "warning",
          timeout: 5000,
        });
      }

      if (rejectedMessages.length > 0) {
        const preview = rejectedMessages.slice(0, 2).join(" | ");
        const overflow =
          rejectedMessages.length > 2
            ? ` (+${rejectedMessages.length - 2} more)`
            : "";
        addToast({
          title: "Some files were not uploaded",
          description: `${preview}${overflow}`,
          color: "warning",
          timeout: 8000,
        });
      }

      if (uploadedCount === 0 && rejectedMessages.length > 0) {
        const uploadFailureMessage =
          rejectedMessages[0] ?? "Upload failed. Please try again.";
        setUploadError(uploadFailureMessage);
        addToast({
          title: "Upload failed",
          description: uploadFailureMessage,
          color: "danger",
          timeout: 8000,
        });
      }

      if (uploadedCount > 0) {
        addToast({
          title: "Upload complete",
          description: `${uploadedCount} file${uploadedCount === 1 ? "" : "s"} uploaded successfully.`,
          color: "success",
          timeout: 5000,
        });
      }

      ecDocumentsLogger.info("Upload session finished.", {
        uploadSessionId,
        uid: activeUid,
        uploadedCount,
        rejectedCount: rejectedMessages.length,
      });

      if (uploadedCount > 0) {
        setPendingFiles([]);
        setIsCategoryModalOpen(false);
        void loadDocuments();
      }
    } catch (error) {
      ecDocumentsLogger.error("Unexpected upload flow failure.", {
        uploadSessionId,
        uid: activeUid,
        code: toErrorCode(error),
        message: toScopedUploadErrorMessage(error, viewerCourseScope, viewerIsBod),
        raw: error,
      });
      const message = toScopedUploadErrorMessage(
        error,
        viewerCourseScope,
        viewerIsBod,
      );
      setUploadError(`Unexpected error: ${message}`);
      addToast({
        title: "Unexpected upload error",
        description: message,
        color: "danger",
        timeout: 8000,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (docItem: DocumentItem) => {
    if (!canViewDocument(viewerProfile, docItem)) {
      addToast({
        title: "Download unavailable",
        description:
          "You can only download documents that belong to your current EC scope.",
        color: "warning",
        timeout: 6000,
      });
      return;
    }

    if (!docItem.storagePath && !docItem.downloadUrl) {
      addToast({
        title: "Download unavailable",
        description: "This file has no download link in storage metadata.",
        color: "warning",
        timeout: 6000,
      });
      return;
    }

    try {
      setDownloadSubmittingId(docItem.id);
      ecDocumentsLogger.info("Starting direct download.", {
        docId: docItem.id,
        name: docItem.name,
      });

      const downloadResult = await withTimeout(
        getCampusDocumentDownloadUrl({ docId: docItem.id }),
        FETCH_URL_TIMEOUT_MS,
        "Get document download URL",
      );

      const params = new URLSearchParams({
        url: downloadResult.downloadUrl,
        name: downloadResult.name || docItem.name,
      });
      const anchor = document.createElement("a");
      anchor.href = `/api/download?${params.toString()}`;
      anchor.download = downloadResult.name || docItem.name;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      addToast({
        title: "Download started",
        description: `${docItem.name} is being saved to your device.`,
        color: "success",
        timeout: 4000,
      });
    } catch (error) {
      ecDocumentsLogger.error("Direct download failed.", {
        docId: docItem.id,
        name: docItem.name,
        code: toErrorCode(error),
        message: toErrorMessage(error),
        raw: error,
      });
      addToast({
        title: "Download failed",
        description: toErrorMessage(error),
        color: "danger",
        timeout: 7000,
      });
    } finally {
      setDownloadSubmittingId((current) =>
        current === docItem.id ? null : current,
      );
    }
  };

  const confirmDeleteDocument = async () => {
    if (!pendingDeleteDocument) return;

    const targetDoc = pendingDeleteDocument;
    setDeleteSubmitting(true);

    try {
      await withTimeout(
        deleteCampusDocument({ docId: targetDoc.id }),
        WRITE_DOC_TIMEOUT_MS,
        "Delete document",
      );

      addToast({
        title: "Document deleted",
        description: `${targetDoc.name} was removed.`,
        color: "success",
        timeout: 5000,
      });

      setPendingDeleteDocument(null);
      void loadDocuments();
    } catch (error) {
      ecDocumentsLogger.error("Delete failed.", {
        docId: targetDoc.id,
        name: targetDoc.name,
        code: toErrorCode(error),
        message: toErrorMessage(error),
        raw: error,
      });

      addToast({
        title: "Delete failed",
        description: toErrorMessage(error),
        color: "danger",
        timeout: 7000,
      });
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <ECPageHeader
        title="Manage and Access Documents"
        description="Upload, organize, and review shared EC files from one place while keeping download and delete actions clear on both desktop and mobile."
        eyebrow="EC Documents"
        icon={FolderKanban}
        variant="hero"
        meta={
          <>
            <Chip variant="flat" className="bg-white/15 text-white">
              {scopedDocuments.length} files
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              {recentUploads} recent uploads
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              {totalStorageMB.toFixed(2)} MB used
            </Chip>
            {viewerIsBod && viewerCourseScope && (
              <Chip variant="flat" className="bg-white/15 text-white">
                Course scope: {viewerCourseScope}
              </Chip>
            )}
          </>
        }
      />

      <ECStatsGrid items={documentSummaryItems} />

      <ECFilterBar controlsClassName="grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="xl:col-span-2">
          <Input
            aria-label="Search documents"
            label="Search"
            value={search}
            onValueChange={setSearch}
            placeholder="Document name or keyword"
          />
        </div>
        <Select
          aria-label="Filter by type"
          label="Type"
          selectedKeys={[typeFilter]}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys as Set<string>)[0];
            if (typeof selected === "string")
              setTypeFilter(selected as DocType | "All Types");
          }}
          disallowEmptySelection
        >
          <SelectItem key="All Types">All Types</SelectItem>
          <SelectItem key="PDF">PDF</SelectItem>
          <SelectItem key="Images">Images</SelectItem>
          <SelectItem key="Word Files">Word Files</SelectItem>
          <SelectItem key="Spreadsheets">Spreadsheets</SelectItem>
        </Select>
        <Select
          aria-label="Filter by category"
          label="Category"
          selectedKeys={[categoryFilter]}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys as Set<string>)[0];
            if (typeof selected === "string")
              setCategoryFilter(selected as DocCategory | "All Categories");
          }}
          disallowEmptySelection
        >
          <SelectItem key="All Categories">All Categories</SelectItem>
          <SelectItem key="Events">Events</SelectItem>
          <SelectItem key="Payments">Payments</SelectItem>
          <SelectItem key="Clearance">Clearance</SelectItem>
          <SelectItem key="General">General</SelectItem>
        </Select>
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept={ACCEPTED_FILE_TYPES}
            onChange={handleFilesSelected}
          />
          <Button
            className="min-h-12 w-full bg-[#7b0000] font-semibold text-white"
            onPress={handleUploadClick}
            isDisabled={uploading || !activeUid}
          >
            {uploading ? "Uploading..." : "Upload Document"}
          </Button>
        </div>
      </ECFilterBar>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <Card shadow="sm" className="border">
          <CardHeader className="flex items-center justify-between px-5 pt-5">
            <div>
              <h2 className="font-semibold text-gray-800">Document Library</h2>
              <p className="text-sm text-campus-text-secondary">
                Browse and sort the shared file set.
              </p>
            </div>
            <Dropdown placement="bottom-end">
              <DropdownTrigger>
                <Button
                  variant="light"
                  className="h-auto min-w-0 px-0 text-sm font-medium text-campus-text-primary data-[hover=true]:bg-transparent"
                >
                  <span className="mr-1 text-campus-text-secondary">Sort:</span>
                  <span>{documentSortLabel}</span>
                  <FiChevronDown className="ml-1" />
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label="Sort documents"
                disallowEmptySelection
                selectionMode="single"
                selectedKeys={new Set([documentSortMode])}
                onAction={(key) => setDocumentSortMode(String(key) as SortMode)}
              >
                <DropdownItem key="latest_to_oldest">
                  Date, new to old
                </DropdownItem>
                <DropdownItem key="oldest_to_latest">
                  Date, old to new
                </DropdownItem>
                <DropdownItem key="alphabetical">
                  Alphabetically, A-Z
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          </CardHeader>
          <CardBody className="p-5 pt-3">
            <ECDataTable
              ariaLabel="EC document library"
              columns={documentColumns}
              items={sortedFilteredDocuments}
              isLoading={documentsLoading}
              emptyTitle="No matching documents"
              emptyDescription="Try another keyword, type, or category."
              loadingContent={<CampusTableBodySkeleton rows={6} columns={6} />}
              renderCell={(docItem, columnKey) => {
                if (columnKey === "name") {
                  return (
                    <div className="space-y-1">
                      <p className="max-w-[280px] truncate font-medium text-gray-800">
                        {docItem.name}
                      </p>
                      {selectedDocId === docItem.id ? (
                        <Chip size="sm" color="primary" variant="flat">
                          Selected
                        </Chip>
                      ) : null}
                    </div>
                  );
                }

                if (columnKey === "type") {
                  return (
                    <Chip color="primary" variant="flat">
                      {docItem.type}
                    </Chip>
                  );
                }

                if (columnKey === "category") {
                  return <Chip variant="bordered">{docItem.category}</Chip>;
                }

                if (columnKey === "size") {
                  return `${formatMB(docItem.sizeBytes)} MB`;
                }

                if (columnKey === "actions") {
                  return (
                    <Button
                      size="sm"
                      variant={
                        selectedDocId === docItem.id ? "flat" : "bordered"
                      }
                      color="primary"
                      onPress={() => {
                        setSelectedDocId(docItem.id);
                        if (isCompactViewport) setDocumentDrawerOpen(true);
                      }}
                    >
                      {selectedDocId === docItem.id ? "Viewing" : "View details"}
                    </Button>
                  );
                }

                return docItem[columnKey as keyof DocumentItem] as string;
              }}
            />
          </CardBody>
        </Card>

        <ECDocumentDetailsPanel
          className="hidden border border-border/70 bg-white/95 shadow-[var(--shadow-soft)] xl:block"
          isLoading={documentsLoading}
          document={
            selectedDocument
              ? {
                  name: selectedDocument.name,
                  type: selectedDocument.type,
                  category: selectedDocument.category,
                  uploadedLabel: selectedDocument.uploadedAt || "-",
                  sizeLabel: `${formatMB(selectedDocument.sizeBytes)} MB`,
                  downloadUrl: selectedDocument.downloadUrl,
                }
              : null
          }
          onDownload={() => {
            if (selectedDocument) void handleDownload(selectedDocument);
          }}
          onDelete={() => {
            if (selectedDocument && selectedDocumentCanDelete) {
              setPendingDeleteDocument(selectedDocument);
            }
          }}
          downloadDisabled={
            !selectedDocumentCanDownload ||
            downloadSubmittingId === selectedDocument?.id
          }
          deleteDisabled={deleteSubmitting || !selectedDocumentCanDelete}
          deleting={deleteSubmitting}
        />
      </div>

      <ECDocumentDetailsDrawer
        isOpen={documentDrawerOpen}
        onOpenChange={setDocumentDrawerOpen}
        isLoading={documentsLoading}
        document={
          selectedDocument
            ? {
                name: selectedDocument.name,
                type: selectedDocument.type,
                category: selectedDocument.category,
                uploadedLabel: selectedDocument.uploadedAt || "-",
                sizeLabel: `${formatMB(selectedDocument.sizeBytes)} MB`,
                downloadUrl: selectedDocument.downloadUrl,
              }
            : null
        }
        onDownload={() => {
          if (selectedDocument) void handleDownload(selectedDocument);
        }}
        onDelete={() => {
          if (selectedDocument && selectedDocumentCanDelete) {
            setPendingDeleteDocument(selectedDocument);
          }
        }}
        downloadDisabled={
          !selectedDocumentCanDownload ||
          downloadSubmittingId === selectedDocument?.id
        }
        deleteDisabled={deleteSubmitting || !selectedDocumentCanDelete}
        deleting={deleteSubmitting}
      />

      <Card shadow="sm" className="border">
        <CardHeader className="px-5 pt-5">
          <div>
            <h2 className="font-semibold text-gray-800">Storage Analytics</h2>
            <p className="text-sm text-campus-text-secondary">
              Shared EC storage across all uploaded documents.
            </p>
          </div>
        </CardHeader>
        <CardBody className="space-y-3 p-5 pt-3">
          <Progress
            aria-label="Storage usage"
            value={storagePercent}
            color="primary"
            className="max-w-full"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="font-medium text-campus-text-primary">
              {totalStorageMB.toFixed(2)} MB used
            </p>
            <p className="text-campus-text-secondary">
              {remainingStorageMB.toFixed(2)} MB remaining
            </p>
          </div>
          <p className="text-sm text-campus-text-secondary">
            {totalStorageMB.toFixed(2)} MB of 1024 MB (1 GB) shared EC storage
            used.
          </p>
        </CardBody>
      </Card>

      <Modal
        isOpen={isCategoryModalOpen}
        onOpenChange={(open) => {
          if (!open && !uploading) handleCancelUpload();
        }}
        size="md"
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader>Select document category</ModalHeader>
              <ModalBody className="space-y-4">
                <p className="text-sm text-campus-text-secondary">
                  Choose one category for {pendingFiles.length} selected file
                  {pendingFiles.length === 1 ? "" : "s"}.
                </p>
                <Select
                  aria-label="Upload category"
                  label="Category"
                  selectedKeys={[uploadCategory]}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys as Set<string>)[0];
                    if (typeof selected === "string")
                      setUploadCategory(selected as DocCategory);
                  }}
                  disallowEmptySelection
                  isDisabled={uploading}
                >
                  <SelectItem key="Events">Events</SelectItem>
                  <SelectItem key="Payments">Payments</SelectItem>
                  <SelectItem key="Clearance">Clearance</SelectItem>
                  <SelectItem key="General">General</SelectItem>
                </Select>
                {uploadError ? (
                  <p className="text-sm text-red-600">{uploadError}</p>
                ) : null}
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="bordered"
                  onPress={handleCancelUpload}
                  isDisabled={uploading}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-[#7b0000] font-semibold text-white"
                  onPress={() => {
                    void handleConfirmUpload();
                  }}
                  isLoading={uploading}
                >
                  Confirm Upload
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal
        isOpen={Boolean(pendingDeleteDocument)}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) setPendingDeleteDocument(null);
        }}
        size="md"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Delete File</ModalHeader>
              <ModalBody className="space-y-2">
                <p className="text-base text-campus-text-primary">
                  Are you sure you want to delete this file?
                </p>
                {pendingDeleteDocument?.name ? (
                  <p className="break-all text-sm text-campus-text-secondary">
                    {pendingDeleteDocument.name}
                  </p>
                ) : null}
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => {
                    setPendingDeleteDocument(null);
                    onClose();
                  }}
                  isDisabled={deleteSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  color="danger"
                  onPress={() => {
                    void confirmDeleteDocument();
                  }}
                  isLoading={deleteSubmitting}
                >
                  Delete
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
