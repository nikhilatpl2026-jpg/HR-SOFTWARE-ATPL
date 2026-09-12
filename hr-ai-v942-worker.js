/* Arora ERP AI PRO V9.4.2 worker wrapper.
   Reuses the V9.4.1 cache-first worker, then applies query-only V9.4.2 rules. */
'use strict';
importScripts('hr-ai-v91-worker.js?v=20260912-15');
importScripts('hr-ai-v942-query-followup-patch.js?v=20260912-16');
