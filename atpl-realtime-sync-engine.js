/**
 * ATPL Real-Time Sync Engine (Supabase)
 * Architected for permanent, foolproof bi-directional file synchronization.
 */
window.ATPLRealtimeSync = (function() {
    const SUPABASE_URL = 'https://gsbyzddibdjxekutpkip.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_iBXc8wO99laFLO7-Pcv-Dw_BbpPJpII';
    
    let supabase = null;
    let globalChannel = null;

    function init() {
        if (!window.supabase) return;
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        setupSubscriptions();
        hijackDeletions();
    }

    function setupSubscriptions() {
        globalChannel = supabase.channel('global_file_sync');
        
        // Listen to Broadcasts for instant cross-browser deletes
        globalChannel.on('broadcast', { event: 'FORCE_DELETE' }, payload => {
            console.log('[ATPL Sync] Remote delete received:', payload);
            const target = payload.payload.name;
            let dirty = false;

            if (window.FILES) {
                const initLen = window.FILES.length;
                window.FILES = window.FILES.filter(f => f.name !== target);
                if (window.FILES.length !== initLen) dirty = true;
            }
            if (window.DOCS) {
                const initLen = window.DOCS.length;
                window.DOCS = window.DOCS.filter(d => d.id !== target && d.document_name !== target && d.file_name !== target);
                if (window.DOCS.length !== initLen) dirty = true;
            }

            if (dirty) {
                try { if(window.renderFiles) window.renderFiles(); } catch(e){}
                try { if(window.renderSheets) window.renderSheets(); } catch(e){}
                try { if(window.updStats) window.updStats(); } catch(e){}
                try { if(window.renderAllFilesPage) window.renderAllFilesPage(); } catch(e){}
                try { if(window.hrDocRender) window.hrDocRender(); } catch(e){}
            }
        });

        // Still listen to postgres just in case
        globalChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'hr_files' }, payload => {
            window.dispatchEvent(new CustomEvent('atpl-global-file-update', { detail: payload }));
        });

        globalChannel.subscribe();
    }

    // Auto-patch the UI buttons so users don't have to change their code!
    function hijackDeletions() {
        setInterval(() => {
            if (window.ATPLFirebase && !window.ATPLFirebase.__isHijacked) {
                window.ATPLFirebase.__isHijacked = true;
                console.log('[ATPL Sync] Automatically wiring UI buttons to Supabase Realtime Engine...');
                
                const origDelete = window.ATPLFirebase.deleteSalaryFile;
                if(origDelete) {
                    window.ATPLFirebase.deleteSalaryFile = async function(name, user) {
                        // Broadcast to other browsers instantly
                        if (globalChannel) globalChannel.send({ type: 'broadcast', event: 'FORCE_DELETE', payload: { name: name }});
                        // Update local instantly
                        if (window.FILES) {
                            window.FILES = window.FILES.filter(f => f.name !== name);
                            try { if(window.renderFiles) window.renderFiles(); } catch(e){}
                        }
                        return origDelete.apply(this, arguments);
                    };
                }

                const origHrDelete = window.ATPLFirebase.deleteHrDoc;
                if(origHrDelete) {
                    window.ATPLFirebase.deleteHrDoc = async function(id, docName, user) {
                        // Broadcast both ID and Name to ensure it's caught
                        if (globalChannel) globalChannel.send({ type: 'broadcast', event: 'FORCE_DELETE', payload: { name: id }});
                        if (globalChannel && docName) globalChannel.send({ type: 'broadcast', event: 'FORCE_DELETE', payload: { name: docName }});
                        // Update local instantly
                        if (window.DOCS) {
                            window.DOCS = window.DOCS.filter(d => d.id !== id && d.document_name !== docName);
                            try { if(window.hrDocRender) window.hrDocRender(); } catch(e){}
                        }
                        return origHrDelete.apply(this, arguments);
                    };
                }
            }
        }, 1000);
    }

    return { init };
})();

if (window.supabase) window.ATPLRealtimeSync.init();