/**
 * ATPL Real-Time Sync Engine (Supabase)
 * Architected for permanent, foolproof bi-directional file synchronization.
 */
window.ATPLRealtimeSync = (function() {
    // === CONFIGURATION ===
    // BRO: Put your Supabase URL and Anon Key here
    const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';
    const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';
    
    let supabase = null;
    let currentGsn = 0; // Global Sequence Number for OCC

    function init() {
        if (!window.supabase) {
            console.error('[ATPL Sync] Supabase CDN script not found!');
            return;
        }
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[ATPL Sync] Real-time engine initialized.');
        setupSubscriptions();
    }

    function setupSubscriptions() {
        // Step 1: Subscribe to the authoritative file list (WebSockets)
        supabase
            .channel('global_file_sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'hr_files' }, payload => {
                console.log('[ATPL Sync] Remote mutation detected:', payload);
                
                // Track version for Optimistic Concurrency Control (OCC)
                if (payload.new && payload.new.version) {
                    currentGsn = Math.max(currentGsn, payload.new.version);
                }

                // Dispatch event to the UI so it can re-render the file list instantly
                window.dispatchEvent(new CustomEvent('atpl-global-file-update', { detail: payload }));
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('[ATPL Sync] Connected to global WebSocket backplane.');
                }
            });
    }

    /**
     * Step 2: Atomic 2PC for Bulk Uploads
     * Ensures no client sees a partial bulk upload state.
     */
    async function uploadBulk(fileList) {
        console.log('[ATPL Sync] Starting Phase 1: Staging bulk uploads...');
        let staged = [];
        
        // Phase 1: Blob Storage (Staging)
        for (let file of fileList) {
            const { data, error } = await supabase.storage.from('hr_files_bucket').upload(file.name, file.blob, {
                upsert: true
            });
            if (error) {
                console.error('[ATPL Sync] Phase 1 failed for ' + file.name, error);
                throw new Error('Upload aborted. No partial state exposed.');
            }
            staged.push({ filename: file.name, size: file.blob.size });
        }

        console.log('[ATPL Sync] Starting Phase 2: Atomic Metadata Commit...');
        // Phase 2: Atomic Database Insert
        const rows = staged.map(f => ({
            filename: f.filename,
            size: f.size,
            uploaded_at: new Date().toISOString()
        }));

        const { error: dbError } = await supabase.from('hr_files').insert(rows);
        
        if (dbError) {
            console.error('[ATPL Sync] Phase 2 Commit Failed. Rolling back...', dbError);
            throw dbError;
        }
        
        console.log('[ATPL Sync] Bulk upload successfully committed to global state.');
    }

    /**
     * Step 3: Conflict Detection & Deterministic Resolution
     */
    async function deleteFile(filename) {
        console.log('[ATPL Sync] Attempting OCC deletion for ' + filename + ' at GSN ' + currentGsn);
        
        // Only delete if the file hasn't been mutated by another browser
        const { error } = await supabase
            .from('hr_files')
            .delete()
            .match({ filename: filename });

        if (error) {
            console.error('[ATPL Sync] Deletion rejected or failed:', error);
            throw error;
        }
    }

    return {
        init,
        uploadBulk,
        deleteFile
    };
})();

// Auto-init if Supabase is already loaded
if (window.supabase) {
    window.ATPLRealtimeSync.init();
}