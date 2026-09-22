import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "dol-challans";
const TABLE = "dol_challans";
const EVENTS = "dol_sync_events";
const MIGRATION_STATE = "dol_migration_state";
const LEGACY_AUTH_URL =
  Deno.env.get("ATPL_LEGACY_AUTH_URL") ??
  "https://script.google.com/macros/s/AKfycby99_893hVtbWOQr67ikxIwiq81MWW8JAa2LuxTu67JBxjQ_iWb-YkqhBmW0RrHU512SQ/exec";

const ALLOWED_ORIGINS = new Set([
  "https://nikhilatpl2026-jpg.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

type LegacyRow = {
  id?: string;
  type?: string;
  name?: string;
  fileHash?: string;
  fingerprint?: string;
  period?: string;
  periodSource?: string;
  digitIds?: string[];
  alnumIds?: string[];
  size?: number;
  mime?: string;
  hasOriginalFile?: boolean;
  uploadedBy?: string;
  uploadedAt?: string;
  updatedAt?: string;
};

const authCache = new Map<string, { until: number; records: LegacyRow[] }>();

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://nikhilatpl2026-jpg.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-atpl-token",
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

function fail(
  req: Request,
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
) {
  return json(req, { ok: false, error: message, ...extra }, status);
}

function assertServiceRoleKey() {
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing in Edge Function environment",
    );
  }
  if (SERVICE_ROLE_KEY.startsWith("sb_secret_")) return;

  const parts = SERVICE_ROLE_KEY.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (payload?.role !== "service_role") {
        throw new Error(
          "SUPABASE_SERVICE_ROLE_KEY is not a service_role key",
        );
      }
      return;
    } catch (e) {
      if (
        String((e as Error)?.message || e).includes(
          "not a service_role",
        )
      ) {
        throw e;
      }
    }
  }

  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is not a recognized service-role secret",
  );
}

function requireServiceRoleClient() {
  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is missing in Edge Function environment");
  }
  assertServiceRoleKey();

  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function cleanType(v: unknown) {
  const type = String(v ?? "").toLowerCase();
  if (type !== "pf" && type !== "esic") {
    throw new Error("Invalid challan type");
  }
  return type;
}

function safeName(name: string) {
  const out = name
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (out || "challan").slice(-140);
}

function arr(v: unknown) {
  return Array.isArray(v) ? v : [];
}

function uniqueStrings(v: unknown[]) {
  return Array.from(
    new Set(v.map((x) => String(x || "")).filter(Boolean)),
  );
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

function validIso(v: unknown) {
  const s = String(v || "");
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function sha256Hex(buf: ArrayBuffer) {
  const dig = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(dig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64Bytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function legacyRequest(
  action: string,
  params: Record<string, unknown>,
  token: string,
) {
  if (!token) throw new Error("Valid ERP login required");

  const u = new URL(LEGACY_AUTH_URL);
  u.searchParams.set("action", action);
  u.searchParams.set("token", token);
  u.searchParams.set("_ts", String(Date.now()));

  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) {
      u.searchParams.set(k, String(v));
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;

  try {
    res = await fetch(u, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(
      "Legacy ERP request failed (" + res.status + ")",
    );
  }

  const text = await res.text();
  let data: any = null;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Legacy ERP returned invalid JSON");
  }

  if (!data || data.ok !== true) {
    throw new Error(
      String(data?.error || "Legacy ERP request failed"),
    );
  }

  return data;
}

async function requireERPAccess(token: string, type: string) {
  if (!token) throw new Error("Valid ERP login required");

  const key = token + ":" + type;
  const now = Date.now();
  const cached = authCache.get(key);

  if (cached && cached.until > now) {
    return cached.records;
  }

  const data = await legacyRequest(
    "getDOLRecords",
    { type },
    token,
  );

  const records = Array.isArray(data.records)
    ? data.records as LegacyRow[]
    : [];

  authCache.set(key, {
    until: now + 60_000,
    records,
  });

  return records;
}

async function announce(
  supabase: ReturnType<typeof createClient>,
  type: string,
) {
  const { error } = await supabase
    .from(EVENTS)
    .insert({ challan_type: type });

  if (error) {
    throw new Error(
      "Realtime event insert failed: " + error.message,
    );
  }
}

async function ensureLegacyIndex(
  supabase: ReturnType<typeof createClient>,
  type: string,
  legacyRows: LegacyRow[],
) {
  const { data: state, error: stateError } = await supabase
    .from(MIGRATION_STATE)
    .select("*")
    .eq("challan_type", type)
    .maybeSingle();

  if (stateError) {
    throw new Error(
      "Migration state read failed: " + stateError.message,
    );
  }

  if (state) return state;

  const now = new Date().toISOString();

  const rows = legacyRows
    .filter((r) =>
      String(r?.type || "").toLowerCase() === type &&
      String(r?.id || "") &&
      String(r?.fileHash || r?.fingerprint || "")
    )
    .map((r) => {
      const hash = String(
        r.fileHash || r.fingerprint || "",
      ).toLowerCase();

      return {
        challan_type: type,
        file_name: String(r.name || "Challan"),
        file_path: null,
        file_hash: hash,
        mime_type: String(
          r.mime || "application/octet-stream",
        ),
        file_size: Number(r.size || 0) || 0,
        period: String(r.period || ""),
        uploaded_by: String(r.uploadedBy || ""),
        member_ids: uniqueStrings([
          ...arr(r.digitIds),
          ...arr(r.alnumIds),
        ]),
        contributions: [],
        legacy_source_id: String(r.id || ""),
        created_at: validIso(r.uploadedAt) || now,
        updated_at:
          validIso(r.updatedAt) ||
          validIso(r.uploadedAt) ||
          now,
      };
    });

  let imported = 0;

  if (rows.length) {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(rows, {
        onConflict: "file_hash",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      throw new Error(
        "Legacy metadata import failed: " + error.message,
      );
    }

    imported = Array.isArray(data) ? data.length : 0;
  }

  const stateRow = {
    challan_type: type,
    indexed_at: now,
    legacy_count: rows.length,
    imported_count: imported,
  };

  const { error: markError } = await supabase
    .from(MIGRATION_STATE)
    .upsert(stateRow, { onConflict: "challan_type" });

  if (markError) {
    throw new Error(
      "Migration state save failed: " + markError.message,
    );
  }

  if (rows.length) await announce(supabase, type);

  return stateRow;
}

async function getRecord(
  supabase: ReturnType<typeof createClient>,
  type: string,
  id: string,
) {
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

async function materializeLegacyOriginal(
  supabase: ReturnType<typeof createClient>,
  row: any,
  token: string,
) {
  if (row.file_path) return row;

  const legacyId = String(row.legacy_source_id || "");
  if (!legacyId) {
    throw new Error(
      "Original file is not in Supabase and no legacy source is available",
    );
  }

  const info = await legacyRequest(
    "getDOLFileInfo",
    { id: legacyId },
    token,
  );

  const chunks = Number(info.chunks || 0);
  if (!chunks) {
    throw new Error("Legacy original file is empty");
  }

  let b64 = "";

  for (let i = 0; i < chunks; i++) {
    const part = await legacyRequest(
      "getDOLFileChunk",
      { id: legacyId, part_index: i },
      token,
    );

    if (Number(part.part_index) !== i) {
      throw new Error(
        "Legacy file chunk sequence mismatch at " + i,
      );
    }

    b64 += String(part.data || "");
  }

  const bytes = base64Bytes(b64);
  b64 = "";

  const actualHash = await sha256Hex(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  );

  const expectedHash = String(row.file_hash || "").toLowerCase();

  if (expectedHash && actualHash !== expectedHash) {
    throw new Error(
      "Legacy original SHA-256 verification failed",
    );
  }

  const mime = String(
    info.mime ||
      row.mime_type ||
      "application/octet-stream",
  );

  const path =
    row.challan_type +
    "/legacy/" +
    actualHash +
    "-" +
    safeName(String(row.file_name || info.name || "challan"));

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });

  if (
    uploadError &&
    !/already exists|duplicate/i.test(uploadError.message)
  ) {
    throw new Error(
      "Legacy Storage migration failed: " +
        uploadError.message,
    );
  }

  const { data: saved, error: saveError } = await supabase
    .from(TABLE)
    .update({
      file_path: path,
      mime_type: mime,
      file_size: bytes.byteLength,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (saveError) {
    throw new Error(
      "Legacy file metadata save failed: " +
        saveError.message,
    );
  }

  await announce(supabase, row.challan_type);

  return saved;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors(req),
    });
  }

  if (req.method !== "POST") {
    return fail(req, "Method not allowed", 405);
  }

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

    const token = String(
      req.headers.get("x-atpl-token") || "",
    );

    const legacyRows = await requireERPAccess(token, type);
    const supabase = requireServiceRoleClient();

    if (action === "health") {
      const { error: readError } = await supabase
        .from(TABLE)
        .select("id")
        .limit(1);

      if (readError) {
        throw new Error(
          "dol_challans SELECT failed: " +
            readError.message,
        );
      }

      return json(req, {
        ok: true,
        authority: "supabase-service-role",
        table: TABLE,
        bucket: BUCKET,
        legacy_access: true,
      });
    }

    if (action === "list") {
      const migration = await ensureLegacyIndex(
        supabase,
        type,
        legacyRows,
      );

      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .eq("challan_type", type)
        .order("period", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);

      return json(req, {
        ok: true,
        records: data || [],
        migration,
      });
    }

    if (action === "file") {
      const id = String(body?.id || "");
      if (!id) throw new Error("Challan id missing");

      let row = await getRecord(supabase, type, id);

      if (!row.file_path) {
        row = await materializeLegacyOriginal(
          supabase,
          row,
          token,
        );
      }

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.file_path, 300);

      if (error || !data?.signedUrl) {
        throw new Error(
          error?.message ||
            "Signed file URL creation failed",
        );
      }

      return json(req, {
        ok: true,
        url: data.signedUrl,
        mime:
          row.mime_type ||
          "application/octet-stream",
      });
    }

    if (action === "updatePeriod") {
      const id = String(body?.id || "");
      if (!id) throw new Error("Challan id missing");

      const old = await getRecord(supabase, type, id);
      const period = String(body?.period || "");

      if (old.legacy_source_id) {
        await legacyRequest(
          "updateDOLRecord",
          {
            id: old.legacy_source_id,
            type,
            period,
          },
          token,
        );
      }

      const { data, error } = await supabase
        .from(TABLE)
        .update({
          period,
          updated_at: new Date().toISOString(),
        })
        .eq("challan_type", type)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw new Error(error.message);

      await announce(supabase, type);

      return json(req, {
        ok: true,
        record: data,
      });
    }

    if (action === "delete") {
      const id = String(body?.id || "");
      if (!id) throw new Error("Challan id missing");

      const row = await getRecord(supabase, type, id);

      if (row.legacy_source_id) {
        await legacyRequest(
          "deleteDOLRecord",
          { id: row.legacy_source_id, type },
          token,
        );
      }

      if (row.file_path) {
        const { error: storageError } =
          await supabase.storage
            .from(BUCKET)
            .remove([row.file_path]);

        if (storageError) {
          throw new Error(
            "Storage delete failed: " +
              storageError.message,
          );
        }
      }

      const { error: deleteError } = await supabase
        .from(TABLE)
        .delete()
        .eq("challan_type", type)
        .eq("id", id);

      if (deleteError) {
        throw new Error(
          "Database delete failed: " +
            deleteError.message,
        );
      }

      const { data: verify, error: verifyError } =
        await supabase
          .from(TABLE)
          .select("id")
          .eq("challan_type", type)
          .eq("id", id)
          .maybeSingle();

      if (verifyError) {
        throw new Error(
          "Delete verification failed: " +
            verifyError.message,
        );
      }

      if (verify) {
        throw new Error(
          "Delete verification failed — challan still exists",
        );
      }

      await announce(supabase, type);

      return json(req, {
        ok: true,
        deleted: true,
        id,
      });
    }

    if (action === "upload") {
      if (!form) {
        throw new Error("Multipart upload required");
      }

      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new Error("Original file missing");
      }

      const buf = await file.arrayBuffer();
      const actualHash = await sha256Hex(buf);
      const claimedHash = String(
        form.get("file_hash") || "",
      ).toLowerCase();

      if (claimedHash && claimedHash !== actualHash) {
        throw new Error("SHA-256 verification failed");
      }

      const { data: existing, error: existingError } =
        await supabase
          .from(TABLE)
          .select("*")
          .eq("file_hash", actualHash)
          .limit(1)
          .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }

      const period = String(form.get("period") || "");
      const uploadedBy = String(
        form.get("uploaded_by") || "",
      );
      const memberIds = parseArray(
        form.get("member_ids"),
      );
      const contributions = parseArray(
        form.get("contributions"),
      );
      const mimeType = String(
        form.get("mime_type") ||
          file.type ||
          "application/octet-stream",
      );
      const fileName = String(
        file.name || "challan",
      );

      if (existing?.file_path) {
        return json(req, {
          ok: true,
          duplicate: true,
          record: existing,
        });
      }

      const path =
        type +
        "/" +
        new Date().toISOString().slice(0, 7) +
        "/" +
        actualHash +
        "-" +
        safeName(fileName);

      const { error: uploadError } =
        await supabase.storage
          .from(BUCKET)
          .upload(path, buf, {
            contentType: mimeType,
            upsert: false,
          });

      if (
        uploadError &&
        !/already exists|duplicate/i.test(
          uploadError.message,
        )
      ) {
        throw new Error(
          "Storage upload failed: " +
            uploadError.message,
        );
      }

      let data: any = null;

      if (existing) {
        const { data: repaired, error: repairError } =
          await supabase
            .from(TABLE)
            .update({
              file_name: fileName,
              file_path: path,
              mime_type: mimeType,
              file_size:
                Number(
                  form.get("file_size") ||
                    file.size ||
                    buf.byteLength,
                ) || buf.byteLength,
              period: period || existing.period || "",
              uploaded_by:
                uploadedBy ||
                existing.uploaded_by ||
                "",
              member_ids:
                memberIds.length
                  ? memberIds
                  : existing.member_ids || [],
              contributions:
                contributions.length
                  ? contributions
                  : existing.contributions || [],
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id)
            .select("*")
            .single();

        if (repairError) {
          try {
            await supabase.storage
              .from(BUCKET)
              .remove([path]);
          } catch (_) {}
          throw new Error(
            "Database repair failed: " +
              repairError.message,
          );
        }

        data = repaired;
      } else {
        const row = {
          challan_type: type,
          file_name: fileName,
          file_path: path,
          file_hash: actualHash,
          mime_type: mimeType,
          file_size:
            Number(
              form.get("file_size") ||
                file.size ||
                buf.byteLength,
            ) || buf.byteLength,
          period,
          uploaded_by: uploadedBy,
          member_ids: memberIds,
          contributions,
          updated_at: new Date().toISOString(),
        };

        const { data: inserted, error: insertError } =
          await supabase
            .from(TABLE)
            .insert(row)
            .select("*")
            .single();

        if (insertError) {
          try {
            await supabase.storage
              .from(BUCKET)
              .remove([path]);
          } catch (_) {}
          throw new Error(
            "Database save failed: " +
              insertError.message,
          );
        }

        data = inserted;
      }

      await announce(supabase, type);

      return json(req, {
        ok: true,
        duplicate: false,
        repairedLegacy: !!existing,
        record: data,
      });
    }

    return fail(req, "Unknown action", 400);
  } catch (e) {
    const message = String(
      (e as Error)?.message ||
        e ||
        "DOL API failed",
    );
    const status =
      /login|access|permission|verification/i.test(
        message,
      )
        ? 401
        : 400;

    console.error("dol-api-v3", message);

    return fail(req, message, status);
  }
});
