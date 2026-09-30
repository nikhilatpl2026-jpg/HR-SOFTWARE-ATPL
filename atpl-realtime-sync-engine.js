/**
 * ATPL Real-Time Sync Engine (Supabase V3)
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
        hijackMutations();
    }

    function setupSubscriptions() {
        globalChannel = supabase.channel('global_file_sync');
        
        // Listen to Broadcasts for instant cross-browser synchronization
        globalChannel.on('broadcast', { event: 'TRIGGER_SYNC' }, payload => {
            console.log('[ATPL Sync] Remote mutation detected, syncing PERFECT state...', payload);
            
            // Call the robust native sync function to update IndexedDB and UI properly
            if (window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.syncNow === 'function') {
                window.ATPLCloudSharedStorageV1.syncNow(true);
            } else if (window.ATPLFirebase && typeof window.ATPLFirebase.fetchAllSalaryFiles === 'function') {
                // Fallback
                window.ATPLFirebase.fetchAllSalaryFiles().then(fbFiles => {
                    if (window.ATPLCloudSharedStorageV1 && window.ATPLCloudSharedStorageV1.handleFirebaseFilesUpdate) {
                        window.ATPLCloudSharedStorageV1.handleFirebaseFilesUpdate({all:fbFiles, removedNames:[]});
                    }
                });
            }
        });

        globalChannel.subscribe();
    }

    // Auto-patch ALL UI mutations so users don't have to change their code!
    function hijackMutations() {
        setInterval(() => {
            if (window.ATPLFirebase && !window.ATPLFirebase.__isHijackedV3) {
                window.ATPLFirebase.__isHijackedV3 = true;
                console.log('[ATPL Sync] Automatically wiring UI buttons to Supabase Realtime Trigger...');
                
                const methodsToHijack = ['deleteSalaryFile', 'deleteHrDoc', 'saveSalaryFile', 'saveHrDoc', 'clearAllSalaryFiles'];
                
                methodsToHijack.forEach(method => {
                    const orig = window.ATPLFirebase[method];
                    if (orig) {
                        window.ATPLFirebase[method] = async function() {
                            // 1. Call the original Firebase function
                            const result = await orig.apply(window.ATPLFirebase, arguments);
                            
                            // 2. Broadcast to all other browsers to run syncNow(true)
                            if (globalChannel) {
                                globalChannel.send({ type: 'broadcast', event: 'TRIGGER_SYNC', payload: { action: method }});
                            }
                            
                            // 3. Force local sync too just to be safe and update IndexedDB correctly
                            setTimeout(() => {
                                if (window.ATPLCloudSharedStorageV1 && typeof window.ATPLCloudSharedStorageV1.syncNow === 'function') {
                                    window.ATPLCloudSharedStorageV1.syncNow(true);
                                }
                            }, 300);
                            
                            return result;
                        };
                    }
                });
            }
        }, 1000);
    }

    return { init };
})();

if (window.supabase) window.ATPLRealtimeSync.init();