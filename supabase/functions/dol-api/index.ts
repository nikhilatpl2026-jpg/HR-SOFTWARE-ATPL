import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "dol-challans";
const TABLE = "dol_challans";
const EVENTS = "dol_sync_events";
const LEGACY_AUTH_URL =
  Deno.env.get("ATPL_LEGACY_AUTH_URL") ??
  "https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec";

const ALLOWED_ORIGINS = new Set([
  "https://nikhilatpl2026-jpg.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

const authCache = new Map<string, number>();

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://nikhilatpl2026-jpg.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-atpl-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function fail(req: Request, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return json(req, { ok: false, error: message, ...extra }, status);
}

function assertServiceRoleKey() {
  if (!SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing in Edge Function environment");
  if (SERVICE_ROLE_KEY.startsWith("sb_secret_")) return;
  const parts = SERVICE_ROLE_KEY.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload?.role !== "service_role") {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not a service_role key");
      }
      return;
    } catch (e) {
      if (String((e as Error)?.message || e).includes("not a service_role")) throw e;
    }
  }
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not a recognized service-role secret");
}

function requireServiceRoleClient() {
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL is missing in Edge Function environment");
  assertServiceRoleKey();
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function cleanType(v: unknown) {
  const t = String(v ?? "").toLowerCase();
  if (t !== "pf" && t !== "esic") throw new Error("Invalid challan type");
  return t;
}

function safeName(name: string) {
  const out = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (out || "challan").slice(-140);
}

function parseArray(v: FormDataEntryValue | null) {
  if (v == null) return [];
  try {
    const x = JSON.parse(String(v));
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

async function sha256Hex(buf: ArrayBuffer) {
  const dig = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(dig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyErpToken(token: string, type: string) {
  if (!token) throw new Error("Valid ERP login required");
  const now = Date.now();
  const cached = authCache.get(token + ":" + type) ?? 0;
  if (cached > now) return;

  const u = new URL(LEGACY_AUTH_URL);
  u.searchParams.set("action", "getDOLRecords");
  u.searchParams.set("type", type);
  u.searchParams.set("token", token);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let res: Response;
  try {
    res = await fetch(u, { method: "GET", redirect: "follow", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error("ERP login verification failed");
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("ERP login verification returned invalid JSON");
  }
  if (!data || data.ok !== true || !Array.isArray(data.records)) {
    throw new Error(String(data?.error || "ERP login/access verification failed"));
  }
  authCache.set(token + ":" + type, now + 60_000);
}

async function announce(supabase: ReturnType<typeof createClient>, type: string) {
  const { error } = await supabase.from(EVENTS).insert({ challan_type: type });
  if (error) throw new Error("Realtime event insert failed: " + error.message);
}

async function getRecord(supabase: ReturnType<typeof createClient>, type: string, id: string) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("challan_type", type)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Challan not found");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(req) });
  }
  if (req.method !== "POST") return fail(req, "Method not allowed", 405);

  try {
    const ct = req.headers.get("content-type") || "";
    let action = "";
    let type = "";
    let body: any = null;
    let form: FormData | null = null;

    if (ct.includes("multipart/form-data")) {
      form = await req.formData();
      action = String(form.get("action") || "");
      type = cleanType(form.get("type"));
    } else {
      body = await req.json().catch(() => ({}));
      action = String(body?.action || "");
      type = cleanType(body?.type);
    }

    const token = String(req.headers.get("x-atpl-token") || "");
    await verifyErpToken(token, type);

    const supabase = requireServiceRoleClient();

    if (action === "health") {
      const { error: readError } = await supabase.from(TABLE).select("id").limit(1);
      if (readError) throw new Error("dol_challans SELECT failed: " + readError.message);
      const { error: eventError } = await supabase.from(EVENTS).insert({ challan_type: type });
      if (eventError) throw new Error("dol_sync_events INSERT failed: " + eventError.message);
      return json(req, {
        ok: true,
        authority: "supabase-service-role",
        table: TABLE,
        bucket: BUCKET,
        realtime_event_insert: true,
      });
    }

    if (action === "list") {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .eq("challan_type", type)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return json(req, { ok: true, records: data || [] });
    }

    if (action === "file") {
      const id = String(body?.id || "");
      if (!id) throw new Error("Challan id missing");
      const row = await getRecord(supabase, type, id);
      if (!row.file_path) throw new Error("Original file is not in the shared vault");
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.file_path, 300);
      if (error || !data?.signedUrl) throw new Error(error?.message || "Signed file URL creation failed");
      return json(req, { ok: true, url: data.signedUrl, mime: row.mime_type || "application/octet-stream" });
    }

    if (action === "updatePeriod") {
      const id = String(body?.id || "");
      if (!id) throw new Error("Challan id missing");
      const period = String(body?.period || "");
      const { data, error } = await supabase
        .from(TABLE)
        .update({ period, updated_at: new Date().toISOString() })
        .eq("challan_type", type)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      await announce(supabase, type);
      return json(req, { ok: true, record: data });
    }

    if (action === "delete") {
      const id = String(body?.id || "");
      if (!id) throw new Error("Challan id missing");
      const row = await getRecord(supabase, type, id);

      if (row.file_path) {
        const { error: storageError } = await supabase.storage.from(BUCKET).remove([row.file_path]);
        if (storageError) throw new Error("Storage delete failed: " + storageError.message);
      }

      const { error: deleteError } = await supabase
        .from(TABLE)
        .delete()
        .eq("challan_type", type)
        .eq("id", id);
      if (deleteError) throw new Error("Database delete failed: " + deleteError.message);

      const { data: verify, error: verifyError } = await supabase
        .from(TABLE)
        .select("id")
        .eq("challan_type", type)
        .eq("id", id)
        .maybeSingle();
      if (verifyError) throw new Error("Delete verification failed: " + verifyError.message);
      if (verify) throw new Error("Delete verification failed — challan still exists");

      await announce(supabase, type);
      return json(req, { ok: true, deleted: true, id });
    }

    if (action === "upload") {
      if (!form) throw new Error("Multipart upload required");
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("Original file missing");

      const buf = await file.arrayBuffer();
      const actualHash = await sha256Hex(buf);
      const claimedHash = String(form.get("file_hash") || "").toLowerCase();
      if (claimedHash && claimedHash !== actualHash) throw new Error("SHA-256 verification failed");

      const { data: duplicate, error: duplicateError } = await supabase
        .from(TABLE)
        .select("*")
        .eq("file_hash", actualHash)
        .limit(1)
        .maybeSingle();
      if (duplicateError) throw new Error(duplicateError.message);
      if (duplicate) return json(req, { ok: true, duplicate: true, record: duplicate });

      const period = String(form.get("period") || "");
      const uploadedBy = String(form.get("uploaded_by") || "");
      const memberIds = parseArray(form.get("member_ids"));
      const contributions = parseArray(form.get("contributions"));
      const mimeType = String(form.get("mime_type") || file.type || "application/octet-stream");
      const fileName = String(file.name || "challan");
      const path = `${type}/${new Date().toISOString().slice(0, 7)}/${actualHash}-${safeName(fileName)}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, buf, { contentType: mimeType, upsert: false });
      if (uploadError) {
        if (!/already exists|duplicate/i.test(uploadError.message)) {
          throw new Error("Storage upload failed: " + uploadError.message);
        }
      }

      const row = {
        challan_type: type,
        file_name: fileName,
        file_path: path,
        file_hash: actualHash,
        mime_type: mimeType,
        file_size: Number(form.get("file_size") || file.size || buf.byteLength) || buf.byteLength,
        period,
        uploaded_by: uploadedBy,
        member_ids: memberIds,
        contributions,
        updated_at: new Date().toISOString(),
      };

      const { data, error: insertError } = await supabase.from(TABLE).insert(row).select("*").single();
      if (insertError) {
        try { await supabase.storage.from(BUCKET).remove([path]); } catch (_) {}
        throw new Error("Database save failed: " + insertError.message);
      }

      try {
        await announce(supabase, type);
      } catch (eventError) {
        try { await supabase.from(TABLE).delete().eq("id", data.id); } catch (_) {}
        try { await supabase.storage.from(BUCKET).remove([path]); } catch (_) {}
        throw eventError;
      }

      return json(req, { ok: true, duplicate: false, record: data });
    }

    return fail(req, "Unknown action", 400);
  } catch (e) {
    const message = String((e as Error)?.message || e || "DOL API failed");
    const status = /login|access|verification/i.test(message) ? 401 : 400;
    console.error("dol-api", message);
    return fail(req, message, status);
  }
});
