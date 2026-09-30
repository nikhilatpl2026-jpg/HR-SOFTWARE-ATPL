/**
 * ATPL Real-Time Sync Engine (Supabase V4 COMPLETE FIREBASE REPLACEMENT)
 * Architected for permanent, foolproof bi-directional file synchronization.
 */
window.ATPLRealtimeSync = (function() {
    const SUPABASE_URL = 'https://gsbyzddibdjxekutpkip.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYnl6ZGRpYmRqeGVrdXRwa2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNTk1NzcsImV4cCI6MjEwNTYzNTU3N30.Bz5NyhVtuJm1MjljiDsnW4036E3qZWgqyEWll7ZqzcI';
    
    let supabase = null;
    let globalChannel = null;

    function init() {
        if (!window.supabase) return;
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        console.log('[ATPL Sync V4] Firebase quota exhausted. Bypassing and using Supabase Native Storage...');
        
        window.ATPLFirebase = {
            fetchAllSalaryFiles: async function() {
                try {
                    const { data, error } = await supabase.from('hr_files').select('*').eq('doc_type', 'salary');
                    if (error) throw error;
                    return (data || []).map(d => ({
                        name: d.filename,
                        original_b64: d.payload || '',
                        saved_at: d.uploaded_at,
                        uploaded_by: 'admin',
                        is_gzip: true // Bypass for legacy ERP handleFirebaseFilesUpdate check
                    }));
                } catch(e) { console.error('Supabase fetchAllSalaryFiles error', e); return []; }
            },
            decodeDocPayload: async function(doc) {
                return { original_b64: doc.original_b64 };
            },
            saveSalaryFile: async function(name, payloadObj, meta) {
                try {
                    const b64 = payloadObj.original_b64 || '';
                    // First completely remove any existing active or tombstone row
                    await supabase.from('hr_files').delete().eq('filename', name);
                    // Insert new active file
                    await supabase.from('hr_files').insert({ 
                        filename: name, 
                        payload: b64, 
                        doc_type: 'salary',
                        size: b64.length, 
                        uploaded_at: new Date().toISOString() 
                    });
                    
                    if (globalChannel) globalChannel.send({ type: 'broadcast', event: 'TRIGGER_SYNC', payload: {} });
                    return true;
                } catch(e) { console.error('Supabase saveSalaryFile error', e); return false; }
            },
            deleteSalaryFile: async function(name, user) {
                try {
                    // Soft delete to create a tombstone so Browser B knows to delete it locally
                    await supabase.from('hr_files').update({ doc_type: 'salary_tombstone', payload: '' }).eq('filename', name).eq('doc_type', 'salary');
                    if (globalChannel) globalChannel.send({ type: 'broadcast', event: 'TRIGGER_SYNC', payload: {} });
                    return true;
                } catch(e) { console.error('Supabase deleteSalaryFile error', e); return false; }
            },
            fetchAllTombstones: async function() {
                try {
                    // Fetch all soft-deleted files so other browsers know what to remove
                    const { data, error } = await supabase.from('hr_files').select('filename, uploaded_at').eq('doc_type', 'salary_tombstone');
                    if (error) throw error;
                    return (data || []).map(d => ({
                        name: d.filename,
                        deleted_at: new Date().toISOString()
                    }));
                } catch(e) { console.error('Supabase fetchTombstones error', e); return []; }
            },
            
            // Do the same for HR Docs
            fetchAllHrDocs: async function() {
                try {
                    const { data, error } = await supabase.from('hr_files').select('*').eq('doc_type', 'hr_doc');
                    if (error) throw error;
                    return (data || []).map(d => {
                        const parsed = JSON.parse(d.payload || '{}');
                        parsed.is_gzip = true;
                        return parsed;
                    });
                } catch(e) { console.error('Supabase fetchAllHrDocs error', e); return []; }
            },
            decodeHrPayload: async function(doc) {
                return doc;
            },
            saveHrDoc: async function(doc) {
                try {
                    await supabase.from('hr_files').delete().eq('filename', doc.id);
                    await supabase.from('hr_files').insert({ 
                        filename: doc.id, 
                        payload: JSON.stringify(doc), 
                        doc_type: 'hr_doc',
                        uploaded_at: new Date().toISOString() 
                    });
                    if (globalChannel) globalChannel.send({ type: 'broadcast', event: 'TRIGGER_SYNC', payload: {} });
                    return true;
                } catch(e) { console.error('Supabase saveHrDoc error', e); return false; }
            },
            deleteHrDoc: async function(id, name, user) {
                try {
                    await supabase.from('hr_files').update({ doc_type: 'hr_doc_tombstone', payload: '' }).eq('filename', id).eq('doc_type', 'hr_doc');
                    if (globalChannel) globalChannel.send({ type: 'broadcast', event: 'TRIGGER_SYNC', payload: {} });
                    return true;
                } catch(e) { console.error('Supabase deleteHrDoc error', e); return false; }
            },
            fetchAllHrTombstones: async function() {
                try {
                    const { data, error } = await supabase.from('hr_files').select('filename').eq('doc_type', 'hr_doc_tombstone');
                    if (error) throw error;
                    return (data || []).map(d => ({
                        id: d.filename,
                        deleted_at: new Date().toISOString()
                    }));
                } catch(e) { console.error('Supabase fetchHrTombstones error', e); return []; }
            },
            subscribeSalaryFiles: function(){ return function(){}; },
            subscribeTombstones: function(){},
            subscribeHrDocs: function(){},
            subscribeHrTombstones: function(){},
            clearAllSalaryFiles: async function() {
                // Bulk soft delete
                await supabase.from('hr_files').update({ doc_type: 'salary_tombstone', payload: '' }).eq('doc_type', 'salary');
                if (globalChannel) globalChannel.send({ type: 'broadcast', event: 'TRIGGER_SYNC', payload: {} });
                return true;
            }
        };

        // 2. Setup Broadcast listener
        globalChannel = supabase.channel('global_file_sync');
        globalChannel.on('broadcast', { event: 'TRIGGER_SYNC' }, payload => {
            console.log('[ATPL Sync] Remote mutation detected, syncing PERFECT state...', payload);
            if (window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.syncNow === 'function') {
                window.ATPLCloudSharedStorageV1.syncNow(true);
            }
        }).subscribe((status) => {
            if(status === 'SUBSCRIBED') console.log('[ATPL Sync] Connected to global WebSocket backplane.');
        });
                // 3. FOOLPROOF POLLING FALLBACK (In case Supabase WebSockets are blocked/disabled)
        let lastKnownTime = -1;
        setInterval(async () => {
            try {
                const { data } = await supabase.from('hr_files').select('uploaded_at').order('uploaded_at', { ascending: false }).limit(1);
                const currentLatest = data && data.length ? data[0].uploaded_at : null;
                if (lastKnownTime !== -1 && lastKnownTime !== currentLatest) {
                    if (window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.syncNow === 'function') {
                        window.ATPLCloudSharedStorageV1.syncNow(true);
                    }
                }
                lastKnownTime = currentLatest;
            } catch(e) {}
        }, 3000);
    }

    return { init };
})();

if (window.supabase) window.ATPLRealtimeSync.init();