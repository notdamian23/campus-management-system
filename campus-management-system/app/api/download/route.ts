import { NextRequest } from "next/server";

const DEFAULT_BUCKET = "campus-27dd9.firebasestorage.app";
const FIREBASE_HOST = "firebasestorage.googleapis.com";

const sanitizeFilename = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return "download";
    return trimmed.replace(/[\\/:*?"<>|]/g, "_");
};

const getDownloadFilename = (requestedName: string | null, sourceUrl: URL) => {
    if (requestedName && requestedName.trim()) {
        return sanitizeFilename(requestedName);
    }

    const rawName = sourceUrl.pathname.split("/").pop() ?? "download";
    try {
        return sanitizeFilename(decodeURIComponent(rawName));
    } catch {
        return sanitizeFilename(rawName);
    }
};

const toAttachmentHeader = (filename: string) => {
    return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

const jsonError = (status: number, message: string) => {
    return Response.json({ error: message }, { status });
};

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const urlParam = req.nextUrl.searchParams.get("url");
    const nameParam = req.nextUrl.searchParams.get("name");

    if (!urlParam) {
        return jsonError(400, "Missing 'url' parameter.");
    }

    let sourceUrl: URL;
    try {
        sourceUrl = new URL(urlParam);
    } catch {
        return jsonError(400, "Invalid download URL.");
    }

    if (sourceUrl.protocol !== "https:") {
        return jsonError(400, "Only https URLs are allowed.");
    }

    if (sourceUrl.hostname !== FIREBASE_HOST) {
        return jsonError(400, "Unsupported download host.");
    }

    const configuredBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;
    if (!sourceUrl.pathname.startsWith(`/v0/b/${configuredBucket}/o/`)) {
        return jsonError(400, "URL does not match configured storage bucket.");
    }

    let upstream: Response;
    try {
        upstream = await fetch(sourceUrl.toString(), { method: "GET", redirect: "follow" });
    } catch {
        return jsonError(502, "Unable to fetch file from storage.");
    }

    if (!upstream.ok || !upstream.body) {
        return jsonError(upstream.status || 502, "Storage download failed.");
    }

    const filename = getDownloadFilename(nameParam, sourceUrl);
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", toAttachmentHeader(filename));
    headers.set("Cache-Control", "private, no-store, max-age=0");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, {
        status: 200,
        headers,
    });
}
