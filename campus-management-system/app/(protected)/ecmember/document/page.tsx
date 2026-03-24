"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import { onAuthStateChanged } from "firebase/auth";
import {
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
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
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from "@heroui/dropdown";
import { Input } from "@heroui/input";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal";
import { Progress } from "@heroui/progress";
import { Select, SelectItem } from "@heroui/select";
import { addToast } from "@heroui/toast";
import { auth, db, storage } from "@/lib/firebase";

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
const ACCEPTED_FILE_TYPES = ".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.csv";

const DOC_TYPES: DocType[] = ["PDF", "Images", "Word Files", "Spreadsheets"];
const DOC_CATEGORIES: DocCategory[] = ["Events", "Payments", "Clearance", "General"];

type FirestoreTimestampLike = { toMillis?: () => number; seconds?: number };

type FirestoreDocumentRecord = {
    name?: string;
    type?: string;
    category?: string;
    sizeBytes?: number;
    downloadURL?: string;
    storagePath?: string;
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
};

type SortMode = "latest_to_oldest" | "oldest_to_latest" | "alphabetical";

const toMillis = (value: FirestoreDocumentRecord["createdAt"]): number => {
    if (value && typeof value === "object" && typeof value.toMillis === "function") {
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

const normalizeDocType = (rawType: string | undefined, filename: string): DocType => {
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

const toErrorCode = (error: unknown): string => {
    if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
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
            const parsed = JSON.parse(serverResponse) as { error?: { message?: string } };
            if (parsed?.error?.message) return parsed.error.message;
        } catch {
            // Ignore JSON parse errors and fall back to generic message extraction.
        }
    }

    if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
        return (error as { message: string }).message;
    }
    if (typeof error === "string") return error;
    return "Unknown error";
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${Math.floor(timeoutMs / 1000)}s.`));
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

const uploadWithTimeout = async (storageRef: StorageReference, file: File, timeoutMs: number): Promise<UploadTaskSnapshot> => {
    return await new Promise<UploadTaskSnapshot>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file, { contentType: file.type || undefined });

        const timer = setTimeout(() => {
            task.cancel();
            reject(new Error(`Upload timed out after ${Math.floor(timeoutMs / 1000)}s.`));
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
    const [documents, setDocuments] = useState<DocumentItem[]>([]);
    const [documentsLoading, setDocumentsLoading] = useState(true);
    const [documentsError, setDocumentsError] = useState("");
    const [authReady, setAuthReady] = useState(false);
    const [activeUid, setActiveUid] = useState<string | null>(null);

    const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState<DocType | "All Types">("All Types");
    const [categoryFilter, setCategoryFilter] = useState<DocCategory | "All Categories">("All Categories");
    const [documentSortMode, setDocumentSortMode] = useState<SortMode>("latest_to_oldest");

    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const [uploadCategory, setUploadCategory] = useState<DocCategory>("General");
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const [pendingDeleteDocument, setPendingDeleteDocument] = useState<DocumentItem | null>(null);
    const [deleteSubmitting, setDeleteSubmitting] = useState(false);

    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (user) => {
            setActiveUid(user?.uid ?? null);
            setAuthReady(true);
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!authReady) return;

        if (!activeUid) {
            setDocuments([]);
            setDocumentsLoading(false);
            setDocumentsError("User session not found.");
            return;
        }

        setDocumentsLoading(true);
        setDocumentsError("");

        const qy = query(collection(db, "ecDocuments"), orderBy("createdAt", "desc"));
        const unsub = onSnapshot(
            qy,
            (snap) => {
                const list: DocumentItem[] = snap.docs.map((d) => {
                    const data = d.data() as FirestoreDocumentRecord;
                    const name = String(data.name ?? "Untitled");
                    const createdAtMs = toMillis(data.createdAt);
                    return {
                        id: d.id,
                        name,
                        type: normalizeDocType(data.type, name),
                        category: normalizeDocCategory(data.category),
                        sizeBytes: Number(data.sizeBytes ?? 0),
                        uploadedAt: createdAtMs ? toDateInputString(createdAtMs) : "",
                        createdAtMs,
                        downloadUrl: String(data.downloadURL ?? ""),
                        storagePath: String(data.storagePath ?? ""),
                    };
                });
                setDocuments(list);
                setDocumentsLoading(false);
            },
            (error) => {
                console.error("[EC Documents] Firestore subscribe failed.", {
                    uid: activeUid,
                    code: toErrorCode(error),
                    message: toErrorMessage(error),
                    raw: error,
                });
                setDocuments([]);
                setDocumentsLoading(false);
                setDocumentsError("Failed to load documents from Firestore.");
            },
        );

        return () => unsub();
    }, [activeUid, authReady]);

    useEffect(() => {
        if (documents.length === 0) {
            setSelectedDocId(null);
            return;
        }

        if (!selectedDocId) {
            setSelectedDocId(documents[0].id);
            return;
        }

        const stillExists = documents.some((docItem) => docItem.id === selectedDocId);
        if (!stillExists) {
            setSelectedDocId(documents[0].id);
        }
    }, [documents, selectedDocId]);

    const filteredDocuments = useMemo(() => {
        return documents.filter((docItem) => {
            const matchesSearch = docItem.name.toLowerCase().includes(search.trim().toLowerCase());
            const matchesType = typeFilter === "All Types" || docItem.type === typeFilter;
            const matchesCategory = categoryFilter === "All Categories" || docItem.category === categoryFilter;
            return matchesSearch && matchesType && matchesCategory;
        });
    }, [documents, search, typeFilter, categoryFilter]);

    const sortedFilteredDocuments = useMemo(() => {
        const list = [...filteredDocuments];

        if (documentSortMode === "alphabetical") {
            list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
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
        return documents.reduce((sum, docItem) => sum + docItem.sizeBytes, 0);
    }, [documents]);

    const totalStorageMB = totalStorageBytes / ONE_MB_IN_BYTES;

    const recentUploads = useMemo(() => {
        const now = Date.now();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        return documents.filter((docItem) => docItem.createdAtMs >= sevenDaysAgo && docItem.createdAtMs <= now).length;
    }, [documents]);

    const selectedDocument = useMemo(() => {
        return documents.find((docItem) => docItem.id === selectedDocId) ?? null;
    }, [documents, selectedDocId]);

    const storagePercent = Math.min((totalStorageBytes / MEMBER_STORAGE_LIMIT_BYTES) * 100, 100);
    const formatMB = (bytes: number) => (bytes / ONE_MB_IN_BYTES).toFixed(2);

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

        setUploading(true);
        setUploadError("");

        const uploadSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        console.info("[EC Documents] Upload session started.", {
            uploadSessionId,
            uid: activeUid,
            fileCount: pendingFiles.length,
            category: uploadCategory,
        });

        try {
            const rejectedMessages: string[] = [];
            let nextTotalBytes = totalStorageBytes;
            let uploadedCount = 0;

            for (const file of pendingFiles) {
                const ext = getFileExtension(file.name);
                const docType = inferDocType(file.name);

                if (BLOCKED_EXTENSIONS.has(ext)) {
                    rejectedMessages.push(`${file.name}: .${ext} files are not allowed.`);
                    continue;
                }

                if (!docType) {
                    rejectedMessages.push(`${file.name}: only Images, PDF, Excel, and Word files are allowed.`);
                    continue;
                }

                if (file.size > MAX_FILE_SIZE_BYTES) {
                    rejectedMessages.push(`${file.name}: exceeds 10 MB per-file limit.`);
                    continue;
                }

                if (nextTotalBytes + file.size > MEMBER_STORAGE_LIMIT_BYTES) {
                    rejectedMessages.push(`${file.name}: exceeds the 1 GB shared EC storage limit.`);
                    continue;
                }

                const docRef = doc(collection(db, "ecDocuments"));
                const storagePath = `ec-documents/shared/${docRef.id}/${file.name}`;
                const storageRef = ref(storage, storagePath);

                try {
                    console.info("[EC Documents] Uploading file.", {
                        uploadSessionId,
                        uid: activeUid,
                        name: file.name,
                        sizeBytes: file.size,
                        storagePath,
                    });

                    const uploaded = await uploadWithTimeout(storageRef, file, UPLOAD_TIMEOUT_MS);
                    const downloadURL = await withTimeout(
                        getDownloadURL(uploaded.ref),
                        FETCH_URL_TIMEOUT_MS,
                        "Get download URL",
                    );

                    await withTimeout(
                        setDoc(docRef, {
                            name: file.name,
                            type: docType,
                            category: uploadCategory,
                            sizeBytes: file.size,
                            downloadURL,
                            storagePath,
                            uploadedByUid: activeUid,
                            createdAt: serverTimestamp(),
                        }),
                        WRITE_DOC_TIMEOUT_MS,
                        "Write Firestore metadata",
                    );

                    nextTotalBytes += file.size;
                    uploadedCount += 1;

                    console.info("[EC Documents] File uploaded successfully.", {
                        uploadSessionId,
                        uid: activeUid,
                        name: file.name,
                        storagePath,
                        docId: docRef.id,
                    });
                } catch (error) {
                    const code = toErrorCode(error);
                    const message = toErrorMessage(error);

                    console.error("[EC Documents] File upload failed.", {
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
                        await withTimeout(deleteObject(storageRef), CLEANUP_TIMEOUT_MS, "Cleanup storage object");
                    } catch (cleanupError) {
                        console.warn("[EC Documents] Failed to cleanup orphaned storage object.", {
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
                const overflow = rejectedMessages.length > 2 ? ` (+${rejectedMessages.length - 2} more)` : "";
                addToast({
                    title: "Some files were not uploaded",
                    description: `${preview}${overflow}`,
                    color: "warning",
                    timeout: 8000,
                });
            }

            if (uploadedCount === 0 && rejectedMessages.length > 0) {
                setUploadError("Upload failed. Open browser console for detailed logs.");
                addToast({
                    title: "Upload failed",
                    description: "All selected files failed. Check console logs for details.",
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

            console.info("[EC Documents] Upload session finished.", {
                uploadSessionId,
                uid: activeUid,
                uploadedCount,
                rejectedCount: rejectedMessages.length,
            });

            if (uploadedCount > 0) {
                setPendingFiles([]);
                setIsCategoryModalOpen(false);
            }
        } catch (error) {
            console.error("[EC Documents] Unexpected upload flow failure.", {
                uploadSessionId,
                uid: activeUid,
                code: toErrorCode(error),
                message: toErrorMessage(error),
                raw: error,
            });
            setUploadError(`Unexpected error: ${toErrorMessage(error)}`);
            addToast({
                title: "Unexpected upload error",
                description: toErrorMessage(error),
                color: "danger",
                timeout: 8000,
            });
        } finally {
            setUploading(false);
        }
    };

    const handleDownload = (docItem: DocumentItem) => {
        if (!docItem.downloadUrl) {
            addToast({
                title: "Download unavailable",
                description: "This file has no download link in storage metadata.",
                color: "warning",
                timeout: 6000,
            });
            return;
        }

        try {
            console.info("[EC Documents] Starting direct download.", {
                docId: docItem.id,
                name: docItem.name,
            });

            const params = new URLSearchParams({
                url: docItem.downloadUrl,
                name: docItem.name,
            });
            const anchor = document.createElement("a");
            anchor.href = `/api/download?${params.toString()}`;
            anchor.download = docItem.name;
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
            console.error("[EC Documents] Direct download failed.", {
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
        }
    };

    const confirmDeleteDocument = async () => {
        if (!pendingDeleteDocument) return;

        const targetDoc = pendingDeleteDocument;
        setDeleteSubmitting(true);

        try {
            if (targetDoc.storagePath) {
                try {
                    await withTimeout(
                        deleteObject(ref(storage, targetDoc.storagePath)),
                        CLEANUP_TIMEOUT_MS,
                        "Delete storage object",
                    );
                } catch (storageError) {
                    if (toErrorCode(storageError) !== "storage/object-not-found") {
                        throw storageError;
                    }

                    console.warn("[EC Documents] Storage object already missing during delete.", {
                        docId: targetDoc.id,
                        name: targetDoc.name,
                        storagePath: targetDoc.storagePath,
                    });
                }
            }

            await withTimeout(deleteDoc(doc(db, "ecDocuments", targetDoc.id)), WRITE_DOC_TIMEOUT_MS, "Delete Firestore metadata");

            addToast({
                title: "Document deleted",
                description: `${targetDoc.name} was removed.`,
                color: "success",
                timeout: 5000,
            });

            setPendingDeleteDocument(null);
        } catch (error) {
            console.error("[EC Documents] Delete failed.", {
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
        <div className="space-y-5 p-3 sm:p-6">
            <Card shadow="sm" className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#b72020] to-[#f39b52] text-white">
                <CardBody className="space-y-4 p-5 sm:p-8">
                    <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">EC Documents</p>
                        <h1 className="text-3xl font-black sm:text-4xl">Manage and Access Documents</h1>
                        <p className="max-w-2xl text-sm text-white/80 sm:text-base">
                            Upload, organize, and review shared EC files from one place.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Chip variant="flat" className="bg-white/15 text-white">{documents.length} files</Chip>
                        <Chip variant="flat" className="bg-white/15 text-white">{recentUploads} recent uploads</Chip>
                        <Chip variant="flat" className="bg-white/15 text-white">{totalStorageMB.toFixed(2)} MB used</Chip>
                    </div>
                    {documentsError ? <p className="text-sm text-white">{documentsError}</p> : null}
                </CardBody>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card shadow="sm" className="border"><CardBody className="p-5"><p className="text-sm text-campus-text-secondary">Total Documents</p><h2 className="mt-2 text-3xl font-black text-blue-600">{documents.length}</h2></CardBody></Card>
                <Card shadow="sm" className="border"><CardBody className="p-5"><p className="text-sm text-campus-text-secondary">Recent Uploads</p><h2 className="mt-2 text-3xl font-black text-emerald-600">{recentUploads}</h2></CardBody></Card>
                <Card shadow="sm" className="border"><CardBody className="p-5"><p className="text-sm text-campus-text-secondary">Storage Used</p><h2 className="mt-2 text-3xl font-black text-amber-600">{totalStorageMB.toFixed(2)} MB</h2></CardBody></Card>
            </div>

            <Card shadow="sm" className="border">
                <CardBody className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-[minmax(0,1.3fr)_200px_200px_180px] xl:items-end">
                    <Input aria-label="Search documents" label="Search" value={search} onValueChange={setSearch} placeholder="Document name or keyword" />
                    <Select aria-label="Filter by type" label="Type" selectedKeys={[typeFilter]} onSelectionChange={(keys) => { const selected = Array.from(keys as Set<string>)[0]; if (typeof selected === "string") setTypeFilter(selected as DocType | "All Types"); }} disallowEmptySelection>
                        <SelectItem key="All Types">All Types</SelectItem>
                        <SelectItem key="PDF">PDF</SelectItem>
                        <SelectItem key="Images">Images</SelectItem>
                        <SelectItem key="Word Files">Word Files</SelectItem>
                        <SelectItem key="Spreadsheets">Spreadsheets</SelectItem>
                    </Select>
                    <Select aria-label="Filter by category" label="Category" selectedKeys={[categoryFilter]} onSelectionChange={(keys) => { const selected = Array.from(keys as Set<string>)[0]; if (typeof selected === "string") setCategoryFilter(selected as DocCategory | "All Categories"); }} disallowEmptySelection>
                        <SelectItem key="All Categories">All Categories</SelectItem>
                        <SelectItem key="Events">Events</SelectItem>
                        <SelectItem key="Payments">Payments</SelectItem>
                        <SelectItem key="Clearance">Clearance</SelectItem>
                        <SelectItem key="General">General</SelectItem>
                    </Select>
                    <div className="space-y-2">
                        <input ref={fileInputRef} type="file" className="hidden" multiple accept={ACCEPTED_FILE_TYPES} onChange={handleFilesSelected} />
                        <Button className="w-full bg-[#7b0000] font-semibold text-white" onPress={handleUploadClick} isDisabled={uploading || !activeUid}>
                            {uploading ? "Uploading..." : "Upload Document"}
                        </Button>
                    </div>
                </CardBody>
            </Card>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card shadow="sm" className="border">
                    <CardHeader className="flex items-center justify-between px-5 pt-5">
                        <div>
                            <h2 className="font-semibold text-gray-800">Document Library</h2>
                            <p className="text-sm text-campus-text-secondary">Browse and sort the shared file set.</p>
                        </div>
                        <Dropdown placement="bottom-end">
                            <DropdownTrigger>
                                <Button variant="light" className="h-auto min-w-0 px-0 text-sm font-medium text-campus-text-primary data-[hover=true]:bg-transparent">
                                    <span className="mr-1 text-campus-text-secondary">Sort:</span>
                                    <span>{documentSortLabel}</span>
                                    <FiChevronDown className="ml-1" />
                                </Button>
                            </DropdownTrigger>
                            <DropdownMenu aria-label="Sort documents" disallowEmptySelection selectionMode="single" selectedKeys={new Set([documentSortMode])} onAction={(key) => setDocumentSortMode(String(key) as SortMode)}>
                                <DropdownItem key="latest_to_oldest">Date, new to old</DropdownItem>
                                <DropdownItem key="oldest_to_latest">Date, old to new</DropdownItem>
                                <DropdownItem key="alphabetical">Alphabetically, A-Z</DropdownItem>
                            </DropdownMenu>
                        </Dropdown>
                    </CardHeader>
                    <CardBody className="p-5 pt-3">
                        {documentsLoading ? (
                            <div className="flex h-80 items-center justify-center rounded-2xl border border-dashed text-campus-text-secondary">Loading documents...</div>
                        ) : sortedFilteredDocuments.length === 0 ? (
                            <div className="flex h-80 items-center justify-center rounded-2xl border border-dashed text-campus-text-secondary">No matching documents found.</div>
                        ) : (
                            <div className="h-80 overflow-y-auto rounded-2xl border">
                                {sortedFilteredDocuments.map((docItem) => (
                                    <Button
                                        key={docItem.id}
                                        variant="light"
                                        className={`h-auto w-full justify-start rounded-none border-b border-gray-200 px-4 py-3 text-left last:border-b-0 ${selectedDocId === docItem.id ? "bg-blue-50" : ""}`}
                                        onPress={() => setSelectedDocId(docItem.id)}
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate font-medium text-gray-800">{docItem.name}</p>
                                            <p className="mt-1 text-xs text-campus-text-secondary">
                                                {docItem.type} | {docItem.category} | {formatMB(docItem.sizeBytes)} MB | {docItem.uploadedAt || "-"}
                                            </p>
                                        </div>
                                    </Button>
                                ))}
                            </div>
                        )}
                    </CardBody>
                </Card>

                <Card shadow="sm" className="border">
                    <CardHeader className="px-5 pt-5">
                        <div>
                            <h2 className="font-semibold text-gray-800">Document Details</h2>
                            <p className="text-sm text-campus-text-secondary">Preview file metadata and actions.</p>
                        </div>
                    </CardHeader>
                    <CardBody className="p-5 pt-3">
                        {selectedDocument ? (
                            <div className="flex h-80 flex-col rounded-2xl border p-4">
                                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                                    <div>
                                        <p className="text-xs text-campus-text-secondary">Name</p>
                                        <p className="break-words font-medium text-gray-900">{selectedDocument.name}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Chip color="primary" variant="flat">{selectedDocument.type}</Chip>
                                        <Chip variant="bordered">{selectedDocument.category}</Chip>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <div><p className="text-xs text-campus-text-secondary">Uploaded At</p><p className="text-sm text-gray-900">{selectedDocument.uploadedAt || "-"}</p></div>
                                        <div><p className="text-xs text-campus-text-secondary">Size</p><p className="text-sm text-gray-900">{formatMB(selectedDocument.sizeBytes)} MB</p></div>
                                    </div>
                                </div>
                                <Button color="warning" className="mt-3 w-full" onPress={() => handleDownload(selectedDocument)} isDisabled={!selectedDocument.downloadUrl}>Download Document</Button>
                                <Button color="danger" className="mt-2 w-full" onPress={() => setPendingDeleteDocument(selectedDocument)} isDisabled={deleteSubmitting}>Delete Document</Button>
                            </div>
                        ) : (
                            <div className="flex h-80 flex-col items-center justify-center rounded-2xl border border-dashed text-campus-text-secondary">
                                <span className="text-4xl">Document</span>
                                <p>Select a document to view details</p>
                            </div>
                        )}
                    </CardBody>
                </Card>
            </div>

            <Card shadow="sm" className="border">
                <CardHeader className="px-5 pt-5">
                    <div>
                        <h2 className="font-semibold text-gray-800">Storage Analytics</h2>
                        <p className="text-sm text-campus-text-secondary">Shared EC storage across all uploaded documents.</p>
                    </div>
                </CardHeader>
                <CardBody className="space-y-3 p-5 pt-3">
                    <Progress aria-label="Storage usage" value={storagePercent} color="primary" className="max-w-full" />
                    <p className="text-sm text-campus-text-secondary">{totalStorageMB.toFixed(2)} MB of 1024 MB (1 GB) shared EC storage used</p>
                </CardBody>
            </Card>

            <Modal isOpen={isCategoryModalOpen} onOpenChange={(open) => { if (!open && !uploading) handleCancelUpload(); }} size="md">
                <ModalContent>
                    {() => (
                        <>
                            <ModalHeader>Select document category</ModalHeader>
                            <ModalBody className="space-y-4">
                                <p className="text-sm text-campus-text-secondary">
                                    Choose one category for {pendingFiles.length} selected file{pendingFiles.length === 1 ? "" : "s"}.
                                </p>
                                <Select aria-label="Upload category" label="Category" selectedKeys={[uploadCategory]} onSelectionChange={(keys) => { const selected = Array.from(keys as Set<string>)[0]; if (typeof selected === "string") setUploadCategory(selected as DocCategory); }} disallowEmptySelection isDisabled={uploading}>
                                    <SelectItem key="Events">Events</SelectItem>
                                    <SelectItem key="Payments">Payments</SelectItem>
                                    <SelectItem key="Clearance">Clearance</SelectItem>
                                    <SelectItem key="General">General</SelectItem>
                                </Select>
                                {uploadError ? <p className="text-sm text-red-600">{uploadError}</p> : null}
                            </ModalBody>
                            <ModalFooter>
                                <Button variant="bordered" onPress={handleCancelUpload} isDisabled={uploading}>Cancel</Button>
                                <Button className="bg-[#7b0000] font-semibold text-white" onPress={() => { void handleConfirmUpload(); }} isLoading={uploading}>Confirm Upload</Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>

            <Modal isOpen={Boolean(pendingDeleteDocument)} onOpenChange={(open) => { if (!open && !deleteSubmitting) setPendingDeleteDocument(null); }} size="md">
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader>Delete File</ModalHeader>
                            <ModalBody className="space-y-2">
                                <p className="text-base text-campus-text-primary">Are you sure you want to delete this file?</p>
                                {pendingDeleteDocument?.name ? <p className="break-all text-sm text-campus-text-secondary">{pendingDeleteDocument.name}</p> : null}
                            </ModalBody>
                            <ModalFooter className="justify-between">
                                <Button variant="bordered" onPress={() => { setPendingDeleteDocument(null); onClose(); }} isDisabled={deleteSubmitting}>Cancel</Button>
                                <Button color="danger" onPress={() => { void confirmDeleteDocument(); }} isLoading={deleteSubmitting}>Delete</Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
        </div>
    );
}
