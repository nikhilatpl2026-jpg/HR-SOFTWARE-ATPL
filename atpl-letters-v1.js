/**
 * ATPL HR LETTERS & LEAVE APPLICATION ENGINE (V1.1)
 * Dedicated module for Arora Textiles Private Limited HR ERP.
 * Features:
 *  - Exact company Leave Application Letter format (A4 70-80% balanced print layout)
 *  - SBI Bank Account Opening Request Letter (Hindi) with letterhead top spacing (5 blank lines)
 *  - Built-in instant English-to-Hindi transliteration/conversion for Bank Letter fields
 *  - Employee Master live lookup by Emp Code or Name (fills Name, Father, Aadhaar, PAN, Address, Designation, Dept)
 *  - Automatic inclusive leave day counter + automatic Next Available / Return Date (+1 day, manually editable)
 *  - Authorized Signatory selector (Sarthak ji, Manish ji, Ayush ji)
 *  - Employee Letter History panel (per-employee + all-employees view, Load, Download .doc, Print/PDF, Delete)
 *  - Word (.doc) & A4 Print/Save-PDF export without window.open/alert
 *  - Non-blocking cross-browser persistence (localStorage, BroadcastChannel, SSE, /api/sync/leave-letters)
 */
(function (window) {
  'use strict';

  var STORAGE_KEY = 'ATPL_LeaveLettersV1';
  var TOMBSTONE_KEY = 'ATPL_LeaveLettersTombstonesV1';
  var PENDING_KEY = 'ATPL_LeaveLettersPendingV1';
  var CLOUD_FILENAME = 'ATPL_LEAVE_LETTERS_DATA.json';
  var DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxiaKVtVJUWqDPtI-9iecG0LE817SfbbQNfUaZouw8sgYr3f1zRffutMu_UGnV-vqy-oA/exec';
  var IDB_NAME = 'ATPL_LETTERS_DB_V1';
  var IDB_STORE = 'kv';
  var CHANNEL_NAME = 'ATPL_ERP_TRIGGER_BUS';
  var SIGNED_BY_OPTIONS = ['Sarthak ji', 'Manish ji', 'Ayush ji'];

  var LETTER_TYPES = [
    { id: 'LEAVE', label: 'Leave Application Letter' },
    { id: 'BANK', label: 'Bank Account Opening Letter (SBI)' }
  ];

  // Offline-first dictionary for accurate Hindi (Devanagari) conversion of Indian names, places & designations
  var HI_DICT = {
    // Locations & Rajasthan / Bikaner / Khara terms
    khara: 'खारा', bikaner: 'बीकानेर', rajasthan: 'राजस्थान', raj: 'राज.',
    jodhpur: 'जोधपुर', jaipur: 'जयपुर', churu: 'चूरू', nagaur: 'नागौर',
    sikar: 'सीकर', jhunjhunu: 'झुंझुनूं', alwar: 'अलवर', ajmer: 'अजमेर',
    kota: 'कोटा', udaipur: 'उदयपुर', bhilwara: 'भीलवाड़ा', pali: 'पाली',
    barmer: 'बाड़मेर', jaisalmer: 'जैसलमेर', hanumangarh: 'हनुमानगढ़',
    ganganagar: 'गंगानगर', sriganganagar: 'श्रीगंगानगर', nokha: 'नोखा',
    lunkaransar: 'लूणकरणसर', kolayat: 'कोलायत', dungargarh: 'डूंगरगढ़',
    khajuwala: 'खाजूवाला', deshnok: 'देशनोक', gangashahar: 'गंगाशहर',
    bhinasar: 'भीनासर', napasar: 'नापासर', jasrasar: 'जसरासर',
    up: 'उत्तर प्रदेश', mp: 'मध्य प्रदेश', bihar: 'बिहार', haryana: 'हरियाणा',
    punjab: 'पंजाब', gujarat: 'गुजरात', delhi: 'दिल्ली', india: 'भारत',
    // Address keywords
    village: 'ग्राम', vill: 'ग्राम', gram: 'ग्राम', post: 'पोस्ट', po: 'पोस्ट',
    tehsil: 'तहसील', teh: 'तहसील', dist: 'जिला', district: 'जिला',
    zila: 'जिला', jila: 'जिला', ward: 'वार्ड', no: 'नं.', number: 'नंबर',
    gali: 'गली', mohalla: 'मोहल्ला', colony: 'कॉलोनी', nagar: 'नगर',
    vihar: 'विहार', road: 'रोड', marg: 'मार्ग', near: 'पास', behind: 'पीछे',
    front: 'सामने', opposite: 'सामने', house: 'मकान', plot: 'प्लॉट',
    chak: 'चक', dhani: 'ढाणी', bas: 'बास', sector: 'सेक्टर', phase: 'फेज',
    pin: 'पिन', pincode: 'पिनकोड', state: 'राज्य', igc: 'आईजीसी',
    riico: 'रीको', industrial: 'इंडस्ट्रियल', area: 'एरिया',
    quarter: 'क्वार्टर', quarters: 'क्वार्टर', staff: 'स्टाफ', factory: 'फैक्ट्री',
    // Designations & titles
    shri: 'श्री', shree: 'श्री', mr: 'श्री', smt: 'श्रीमती', mrs: 'श्रीमती', late: 'स्व.',
    director: 'निदेशक', directors: 'निदेशक', manager: 'प्रबंधक', hr: 'एचआर',
    supervisor: 'सुपरवाइजर', operator: 'ऑपरेटर', helper: 'हेल्पर',
    accountant: 'एकाउंटेंट', clerk: 'क्लर्क', guard: 'गार्ड',
    security: 'सुरक्षा', driver: 'ड्राइवर', fitter: 'फिटर',
    electrician: 'इलेक्ट्रीशियन', mechanic: 'मैकेनिक', master: 'मास्टर',
    foreman: 'फोरमैन', worker: 'वर्कर', officer: 'अधिकारी', head: 'प्रमुख',
    incharge: 'इंचार्ज', authorized: 'अधिकृत', signatory: 'हस्ताक्षरकर्ता',
    owner: 'मालिक', partner: 'साझेदार', gm: 'महाप्रबंधक', ji: 'जी',
    // Common names & surnames
    sampat: 'संपत', lal: 'लाल', ram: 'राम', kumar: 'कुमार', singh: 'सिंह',
    sharma: 'शर्मा', verma: 'वर्मा', arora: 'अरोड़ा', sarthak: 'सार्थक',
    manish: 'मनीष', ayush: 'आयुष', kamlesh: 'कमलेश', ramesh: 'रमेश',
    suresh: 'सुरेश', mahesh: 'महेश', mukesh: 'मुकेश', dinesh: 'दिनेश',
    rajesh: 'राजेश', ganesh: 'गणेश', naresh: 'नरेश', lokesh: 'लोकेश',
    rakesh: 'राकेश', yogesh: 'योगेश', virendra: 'वीरेंद्र', mahendra: 'महेंद्र',
    narendra: 'नरेंद्र', surendra: 'सुरेंद्र', rajendra: 'राजेंद्र',
    devendra: 'देवेंद्र', jitendra: 'जितेंद्र', ravindra: 'रविंद्र',
    bhupendra: 'भूपेंद्र', gajendra: 'गजेंद्र', harish: 'हरीश',
    jagdish: 'जगदीश', satish: 'सतीश', ashish: 'आशीष', girish: 'गिरीश',
    pawan: 'पवन', manoj: 'मनोज', vinod: 'विनोद', pramod: 'प्रमोद',
    ashok: 'अशोक', vijay: 'विजय', sanjay: 'संजय', ajay: 'अजय',
    anil: 'अनिल', sunil: 'सुनील', kapil: 'कपिल', sushil: 'सुशील',
    vikas: 'विकास', deepak: 'दीपक', prakash: 'प्रकाश', narayan: 'नारायण',
    bhagwan: 'भगवान', shankar: 'शंकर', gopal: 'गोपाल', mohan: 'मोहन',
    sohan: 'सोहन', rohan: 'रोहन', kishan: 'किशन', bhanwar: 'भंवर',
    mangi: 'मांगी', chhagan: 'छगन', ratan: 'रतन', babu: 'बाबू',
    girdhari: 'गिरधारी', kailash: 'कैलाश', devi: 'देवी', das: 'दास',
    prasad: 'प्रसाद', nath: 'नाथ', chand: 'चंद', kaur: 'कौर',
    om: 'ओम', tej: 'तेज', pukhraj: 'पुखराज', rameshwar: 'रामेश्वर',
    khan: 'खान', ali: 'अली', ahmed: 'अहमद', mohammed: 'मोहम्मद',
    yadav: 'यादव', patel: 'पटेल', gupta: 'गुप्ता', agarwal: 'अग्रवाल',
    bansal: 'बंसल', garg: 'गर्ग', joshi: 'जोशी', vyas: 'व्यास',
    purohit: 'पुरोहित', tiwari: 'तिवारी', pandey: 'पांडे', mishra: 'मिश्रा',
    dubey: 'दुबे', shukla: 'शुक्ला', rathore: 'राठौड़', shekhawat: 'शेखावत',
    solanki: 'सोलंकी', chauhan: 'चौहान', tanwar: 'तंवर', parihar: 'परिहार',
    bhati: 'भाटी', panwar: 'पंवार', soni: 'सोनी', jain: 'जैन',
    goyal: 'गोयल', mittal: 'मित्तल', khandelwal: 'खंडेलवाल', saini: 'सैनी',
    mali: 'माली', nai: 'नाई', darzi: 'दर्जी', lohar: 'लोहार', khati: 'खाती',
    kumawat: 'कुमावत', meghwal: 'मेघवाल', bishnoi: 'बिश्नोई',
    prajapat: 'प्रजापत', suthar: 'सुथार', choudhary: 'चौधरी', jat: 'जाट',
    rajput: 'राजपूत', brahman: 'ब्राह्मण', swami: 'स्वामी', pareek: 'पारीक'
  };

  function hasDevanagari(str) {
    return /[ऀ-ॿ]/.test(String(str || ''));
  }

  function transliterateWordToHindi(rawWord) {
    if (!rawWord) return '';
    if (hasDevanagari(rawWord)) return rawWord;
    // Preserve numbers or alphanumeric codes like E-90, 334601, B-12
    if (!/[a-zA-Z]/.test(rawWord) || /\d/.test(rawWord)) return rawWord;

    var lower = rawWord.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(HI_DICT, lower)) {
      return HI_DICT[lower];
    }

    var VOWELS = {
      aa: { indep: 'आ', matra: 'ा' },
      ee: { indep: 'ई', matra: 'ी' },
      ii: { indep: 'ई', matra: 'ी' },
      oo: { indep: 'ऊ', matra: 'ू' },
      uu: { indep: 'ऊ', matra: 'ू' },
      ai: { indep: 'ऐ', matra: 'ै' },
      ei: { indep: 'ऐ', matra: 'ै' },
      au: { indep: 'औ', matra: 'ौ' },
      ou: { indep: 'औ', matra: 'ौ' },
      a:  { indep: 'अ', matra: '' },
      i:  { indep: 'इ', matra: 'ि' },
      u:  { indep: 'उ', matra: 'ु' },
      e:  { indep: 'ए', matra: 'े' },
      o:  { indep: 'ओ', matra: 'ो' }
    };

    var CONS = [
      ['ksh', 'क्ष'], ['gya', 'ज्ञ'], ['shr', 'श्र'],
      ['chh', 'छ'], ['kh', 'ख'], ['gh', 'घ'],
      ['ch', 'च'], ['jh', 'झ'], ['th', 'थ'], ['dh', 'ध'],
      ['ph', 'फ'], ['bh', 'भ'], ['sh', 'श'],
      ['k', 'क'], ['q', 'क'], ['g', 'ग'], ['c', 'क'],
      ['j', 'ज'], ['z', 'ज़'], ['t', 'त'], ['d', 'द'],
      ['n', 'न'], ['p', 'प'], ['f', 'फ'], ['b', 'ब'],
      ['m', 'म'], ['y', 'य'], ['r', 'र'], ['l', 'ल'],
      ['v', 'व'], ['w', 'व'], ['s', 'स'], ['h', 'ह'],
      ['x', 'क्स']
    ];

    function matchVowel(str, idx) {
      var two = str.slice(idx, idx + 2);
      if (VOWELS[two]) return { len: 2, key: two, info: VOWELS[two] };
      var one = str.charAt(idx);
      if (VOWELS[one]) return { len: 1, key: one, info: VOWELS[one] };
      return null;
    }

    function matchCons(str, idx) {
      for (var i = 0; i < CONS.length; i++) {
        var pat = CONS[i][0];
        if (str.slice(idx, idx + pat.length) === pat) {
          return { len: pat.length, key: pat, glyph: CONS[i][1] };
        }
      }
      return null;
    }

    var out = '';
    var i = 0;
    var len = lower.length;
    var prevWasCons = false;

    while (i < len) {
      var v = matchVowel(lower, i);
      if (v) {
        if (prevWasCons) {
          out += v.info.matra;
        } else {
          out += v.info.indep;
        }
        prevWasCons = false;
        i += v.len;
        continue;
      }

      var c = matchCons(lower, i);
      if (c) {
        // Handle nasal anusvara 'n'/'m' directly before another consonant (e.g. sampat, shankar)
        if ((c.key === 'n' || c.key === 'm') && i > 0 && i + 1 < len) {
          var nextC = matchCons(lower, i + 1);
          var nextV = matchVowel(lower, i + 1);
          if (nextC && !nextV && nextC.key !== 'n' && nextC.key !== 'm' && nextC.key !== 'h' && nextC.key !== 'y' && nextC.key !== 'r' && nextC.key !== 'l' && nextC.key !== 'v' && nextC.key !== 'w') {
            out += 'ं';
            prevWasCons = false;
            i += 1;
            continue;
          }
        }
        // Collapse identical doubled consonants cleanly (e.g. 'tt' -> 'त्त' / 'll' -> 'ल्ल' or single)
        if (prevWasCons) {
          // Insert halant only for genuine medial clusters (like 'pr', 'kr', 'sharma' rm, etc.), keep simple schwa if vowel preceded
          // Actually in Hindi names like 'babulal', 'sampat', 'mohan', consonant followed by consonant without vowel is usually full schwa unless 'r' or doubled
          if (c.key === 'r' || c.key === 'y' || c.key === 'v' || c.key === 'l' || c.key === 't' || c.key === 'd') {
            // Check if previous char was 's'/'p'/'k'/'g'/'b'/'t'/'d' at start or medial cluster like 'pr', 'sharma'
            var prevCh = i > 0 ? lower.charAt(i - 1) : '';
            if (prevCh === c.key) {
              out += '्' + c.glyph;
              prevWasCons = true;
              i += c.len;
              continue;
            }
          }
        }
        out += c.glyph;
        prevWasCons = true;
        i += c.len;
        continue;
      }

      out += rawWord.charAt(i);
      prevWasCons = false;
      i += 1;
    }

    return out || rawWord;
  }

  function convertEnglishToHindi(text) {
    var s = String(text == null ? '' : text);
    if (!s) return '';
    // Replace runs of ASCII letters (preserving punctuation, numbers, whitespace, and existing Devanagari)
    return s.replace(/[A-Za-z0-9-]+/g, function (tok) {
      return transliterateWordToHindi(tok);
    });
  }

  function todayISO() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function parseISODateParts(iso) {
    if (!iso || typeof iso !== 'string') return null;
    var m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, m: mo, d: d };
  }

  function addDaysISO(iso, deltaDays) {
    var p = parseISODateParts(iso);
    if (!p) return '';
    var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + (Number(deltaDays) || 0)));
    var y = dt.getUTCFullYear();
    var m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    var d = String(dt.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function diffDaysInclusive(fromISO, toISO) {
    var f = parseISODateParts(fromISO);
    var t = parseISODateParts(toISO);
    if (!f || !t) return 0;
    var ms = Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(f.y, f.m - 1, f.d);
    if (ms < 0) return 0;
    return Math.round(ms / 86400000) + 1;
  }

  function formatDateDDMMYYYY(iso) {
    var p = parseISODateParts(iso);
    if (!p) return iso ? String(iso) : '__/__/____';
    return String(p.d).padStart(2, '0') + '/' + String(p.m).padStart(2, '0') + '/' + p.y;
  }

  function formatDateDDMMYY(iso) {
    var p = parseISODateParts(iso);
    if (!p) return iso ? String(iso) : '__/__/__';
    return String(p.d).padStart(2, '0') + '/' + String(p.m).padStart(2, '0') + '/' + String(p.y).slice(-2);
  }

  function normalizeCode(code) {
    if (code == null) return '';
    return String(code).trim().replace(/\.0+$/, '').toLowerCase().replace(/^0+/, '');
  }

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var MY_CLIENT_ID = 'ltr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  var lastCloudSyncAtMs = 0;
  var lastSeenDriveFileTs = 0;
  var activeSyncPromise = null;
  var activePushPromise = null;
  var pendingPushQueued = false;

  var state = {
    records: [],
    tombstones: {},
    pending: { saves: {}, deletes: {} },
    historyScope: 'all', // 'all' | 'employee'
    historyTypeFilter: 'ALL', // 'ALL' | 'LEAVE' | 'BANK'
    historySearch: '',
    statusMessage: '',
    statusTone: 'info',
    syncStatus: 'idle', // 'idle' | 'syncing' | 'synced' | 'pending' | 'offline'
    lastSyncAt: '',
    returnDateManual: false,
    editingId: null,
    form: {
      letterType: 'LEAVE',
      letterDate: todayISO(),
      empCode: '',
      empName: '',
      designation: '',
      department: '',
      fromDate: todayISO(),
      toDate: todayISO(),
      days: 1,
      returnDate: addDaysISO(todayISO(), 1),
      reason: 'some personal reason',
      signedBy: 'Sarthak ji',
      // Bank Account Opening Letter fields
      fatherName: '',
      aadhaarNo: '',
      panNo: '',
      permanentAddress: '',
      authSignatory: '',
      signatoryName: '',
      signatoryDesignation: '',
      letterheadSpace: true,
      hideBankHeader: false,
      autoHindi: true
    }
  };

  function parseTsMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var ms = Date.parse(String(v));
    return isFinite(ms) ? ms : 0;
  }

  function normalizeNameKey(str) {
    return String(str || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function getGasUrl() {
    try {
      var custom = (window.localStorage && window.localStorage.getItem('ATPL_CUSTOM_GAS_URL')) || '';
      if (custom && custom.trim() && /^https:\/\/script\.google\.com\/macros\/s\//.test(custom.trim())) {
        return custom.trim();
      }
      if (window.ATPL_CUSTOM_GAS_URL && String(window.ATPL_CUSTOM_GAS_URL).trim()) {
        return String(window.ATPL_CUSTOM_GAS_URL).trim();
      }
      if (window.ATPL_GAS_URL && String(window.ATPL_GAS_URL).trim() && /^https:\/\/script\.google\.com\/macros\/s\//.test(String(window.ATPL_GAS_URL).trim())) {
        return String(window.ATPL_GAS_URL).trim();
      }
    } catch (_) {}
    return DEFAULT_GAS_URL;
  }

  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  function utf8ToB64(str) {
    if (typeof Buffer !== 'undefined') {
      try { return Buffer.from(str, 'utf8').toString('base64'); } catch (_) {}
    }
    if (typeof btoa !== 'undefined') {
      try { return btoa(unescape(encodeURIComponent(str))); } catch (_) {}
    }
    var utf8Bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) utf8Bytes.push(c);
      else if (c < 2048) {
        utf8Bytes.push(192 | (c >> 6), 128 | (c & 63));
      } else if (c < 65536) {
        utf8Bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
      } else {
        utf8Bytes.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
      }
    }
    var res = '';
    for (var j = 0; j < utf8Bytes.length; j += 3) {
      var b1 = utf8Bytes[j];
      var b2 = j + 1 < utf8Bytes.length ? utf8Bytes[j + 1] : NaN;
      var b3 = j + 2 < utf8Bytes.length ? utf8Bytes[j + 2] : NaN;
      res += B64_CHARS.charAt(b1 >> 2);
      res += B64_CHARS.charAt(((b1 & 3) << 4) | (isNaN(b2) ? 0 : (b2 >> 4)));
      res += isNaN(b2) ? '=' : B64_CHARS.charAt(((b2 & 15) << 2) | (isNaN(b3) ? 0 : (b3 >> 6)));
      res += isNaN(b3) ? '=' : B64_CHARS.charAt(b3 & 63);
    }
    return res;
  }

  function b64ToUtf8(b64) {
    if (!b64 || typeof b64 !== 'string') return '';
    var clean = b64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') {
      try { return Buffer.from(clean, 'base64').toString('utf8'); } catch (_) {}
    }
    if (typeof atob !== 'undefined') {
      try { return decodeURIComponent(escape(atob(clean))); } catch (_) {}
    }
    var bytes = [];
    for (var i = 0; i < clean.length; i += 4) {
      var enc1 = B64_CHARS.indexOf(clean.charAt(i));
      var enc2 = B64_CHARS.indexOf(clean.charAt(i + 1));
      var enc3 = clean.charAt(i + 2) === '=' ? -1 : B64_CHARS.indexOf(clean.charAt(i + 2));
      var enc4 = clean.charAt(i + 3) === '=' ? -1 : B64_CHARS.indexOf(clean.charAt(i + 3));
      bytes.push((enc1 << 2) | (enc2 >> 4));
      if (enc3 !== -1) bytes.push(((enc2 & 15) << 4) | (enc3 >> 2));
      if (enc4 !== -1) bytes.push(((enc3 & 3) << 6) | enc4);
    }
    var out = '', k = 0;
    while (k < bytes.length) {
      var c1 = bytes[k++];
      if (c1 < 128) out += String.fromCharCode(c1);
      else if (c1 > 191 && c1 < 224) {
        var c2 = bytes[k++];
        out += String.fromCharCode(((c1 & 31) << 6) | (c2 & 63));
      } else {
        var c2b = bytes[k++];
        var c3b = bytes[k++];
        out += String.fromCharCode(((c1 & 15) << 12) | ((c2b & 63) << 6) | (c3b & 63));
      }
    }
    return out;
  }

  function callGoogleBackend(action, params) {
    if (window.ATPLGoogleSync && typeof window.ATPLGoogleSync.callGoogleBackend === 'function') {
      return Promise.resolve().then(function () {
        return window.ATPLGoogleSync.callGoogleBackend(action, params);
      }).then(function (res) {
        if (res != null) return res;
        return directGasPost(action, params);
      }).catch(function () {
        return directGasPost(action, params);
      });
    }
    return directGasPost(action, params);
  }

  function directGasPost(action, params) {
    var endpoint = getGasUrl();
    if (!endpoint || typeof window.fetch !== 'function') return Promise.resolve(null);
    var p = Object.assign({ action: action, sender: MY_CLIENT_ID, _ts: Date.now() }, params || {});
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function () { try { controller.abort(); } catch (_) {} }, 18000) : null;
    return window.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(p),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timeoutId) clearTimeout(timeoutId);
      if (!res || !res.ok) return null;
      return res.json().catch(function () { return null; });
    }).catch(function () {
      if (timeoutId) clearTimeout(timeoutId);
      return null;
    });
  }

  function getEmployeeMasterList() {
    var list = [];
    if (window.EM && Array.isArray(window.EM.data) && window.EM.data.length) {
      list = window.EM.data;
    } else if (Array.isArray(window.EMP_MASTER_DATA) && window.EMP_MASTER_DATA.length) {
      list = window.EMP_MASTER_DATA;
    } else {
      try {
        var raw = window.localStorage && (
          window.localStorage.getItem('AroraTextilesEmployeeMasterV3') ||
          window.localStorage.getItem('ATPL_EmployeeMaster_V3') ||
          window.localStorage.getItem('EM_DATA')
        );
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
          else if (parsed && Array.isArray(parsed.data)) list = parsed.data;
          else if (parsed && Array.isArray(parsed.employees)) list = parsed.employees;
        }
      } catch (_) {}
    }

    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || typeof e !== 'object') continue;
      var code = String(e.emp_id || e.empCode || e.emp_code || e.code || e.id || '').trim();
      if (!code) continue;
      var norm = normalizeCode(code) || code.toLowerCase();
      if (seen[norm]) continue;
      seen[norm] = true;
      out.push({
        empCode: code,
        empName: String(e.name || e.emp_name || e.empName || e.employee_name || '').trim(),
        fatherName: String(e.father || e.father_name || e.fathers_name || e.fatherName || '').trim(),
        aadhaarNo: String(e.aadhaar_no || e.aadhar_no || e.aadhaar || e.aadhar || '').trim(),
        panNo: String(e.pan_no || e.pan || e.pan_number || e.panNo || '').trim(),
        permanentAddress: String(e.permanent_address || e.present_address || e.address || '').trim(),
        designation: String(e.desig || e.designation || e.post || '').trim(),
        department: String(e.dept || e.department || '').trim(),
        phone: String(e.phone_no || e.mobile || e.phone || '').trim()
      });
    }
    return out;
  }

  function findEmployeeByCode(code) {
    var raw = String(code || '').trim();
    if (!raw) return null;
    var norm = normalizeCode(raw);
    var list = getEmployeeMasterList();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].empCode).trim().toLowerCase() === raw.toLowerCase()) return list[i];
    }
    for (var j = 0; j < list.length; j++) {
      if (norm && normalizeCode(list[j].empCode) === norm) return list[j];
    }
    return null;
  }

  function searchEmployees(query) {
    var q = String(query || '').trim().toLowerCase();
    var list = getEmployeeMasterList();
    if (!q) return list.slice(0, 12);
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (
        e.empCode.toLowerCase().indexOf(q) >= 0 ||
        e.empName.toLowerCase().indexOf(q) >= 0 ||
        e.department.toLowerCase().indexOf(q) >= 0 ||
        e.designation.toLowerCase().indexOf(q) >= 0
      ) {
        hits.push(e);
        if (hits.length >= 12) break;
      }
    }
    return hits;
  }

  function ensurePendingShape(p) {
    var obj = (p && typeof p === 'object') ? p : {};
    return {
      saves: (obj.saves && typeof obj.saves === 'object') ? obj.saves : {},
      deletes: (obj.deletes && typeof obj.deletes === 'object') ? obj.deletes : {}
    };
  }

  function getPendingCount() {
    var p = ensurePendingShape(state.pending);
    return Object.keys(p.saves).length + Object.keys(p.deletes).length;
  }

  function hasPending() {
    return getPendingCount() > 0;
  }

  function setPendingSave(id, updatedAt) {
    if (!id) return;
    state.pending = ensurePendingShape(state.pending);
    state.pending.saves[id] = updatedAt || new Date().toISOString();
    delete state.pending.deletes[id];
  }

  function setPendingDelete(id, deletedAt) {
    if (!id) return;
    state.pending = ensurePendingShape(state.pending);
    state.pending.deletes[id] = deletedAt || new Date().toISOString();
    delete state.pending.saves[id];
  }

  function openLettersIdb() {
    try {
      var idb = window.indexedDB;
      if (!idb || typeof idb.open !== 'function') return Promise.resolve(null);
      return new Promise(function (resolve) {
        try {
          var req = idb.open(IDB_NAME, 1);
          req.onupgradeneeded = function () {
            try {
              var db = req.result;
              if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
              }
            } catch (_) {}
          };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { resolve(null); };
        } catch (_) {
          resolve(null);
        }
      });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function idbWriteState(records, tombstones, pending) {
    return openLettersIdb().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          var store = tx.objectStore(IDB_STORE);
          store.put(Array.isArray(records) ? records : [], 'records');
          store.put((tombstones && typeof tombstones === 'object') ? tombstones : {}, 'tombstones');
          store.put(ensurePendingShape(pending), 'pending');
          tx.oncomplete = function () { try { db.close(); } catch (_) {} resolve(true); };
          tx.onerror = function () { try { db.close(); } catch (_) {} resolve(false); };
        } catch (_) {
          try { db.close(); } catch (_) {}
          resolve(false);
        }
      });
    });
  }

  function idbReadState() {
    return openLettersIdb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readonly');
          var store = tx.objectStore(IDB_STORE);
          var rReq = store.get('records');
          var tReq = store.get('tombstones');
          var pReq = store.get('pending');
          tx.oncomplete = function () {
            try { db.close(); } catch (_) {}
            resolve({
              records: Array.isArray(rReq.result) ? rReq.result : [],
              tombstones: (tReq.result && typeof tReq.result === 'object') ? tReq.result : {},
              pending: ensurePendingShape(pReq.result)
            });
          };
          tx.onerror = function () { try { db.close(); } catch (_) {} resolve(null); };
        } catch (_) {
          try { db.close(); } catch (_) {}
          resolve(null);
        }
      });
    });
  }

  function normalizeRecordShape(r) {
    if (!r || typeof r !== 'object' || !r.id) return null;
    var out = Object.assign({}, r);
    out.letterType = (String(out.letterType || 'LEAVE').toUpperCase() === 'BANK') ? 'BANK' : 'LEAVE';
    if (!out.updatedAt) out.updatedAt = out.createdAt || new Date().toISOString();
    return out;
  }

  function loadFromLocalStorage() {
    try {
      if (!window.localStorage) return;
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      var tombRaw = window.localStorage.getItem(TOMBSTONE_KEY);
      var parsedTombs = tombRaw ? (JSON.parse(tombRaw) || {}) : {};
      var pendRaw = window.localStorage.getItem(PENDING_KEY);
      state.pending = pendRaw ? ensurePendingShape(JSON.parse(pendRaw)) : { saves: {}, deletes: {} };
      state.tombstones = (parsedTombs && typeof parsedTombs === 'object') ? parsedTombs : {};
      if (Array.isArray(parsed)) {
        state.records = parsed.map(normalizeRecordShape).filter(function (r) {
          if (!r || !r.id) return false;
          var tTs = parseTsMs(state.tombstones[r.id]);
          var rTs = parseTsMs(r.updatedAt || r.createdAt);
          if (state.tombstones[r.id] && (!rTs || tTs >= rTs)) return false;
          if (state.tombstones[r.id] && rTs > tTs) delete state.tombstones[r.id];
          return true;
        });
      }
    } catch (_) {
      state.records = [];
    }
  }

  function saveToLocalStorage() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
        window.localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(state.tombstones || {}));
        window.localStorage.setItem(PENDING_KEY, JSON.stringify(ensurePendingShape(state.pending)));
      }
    } catch (_) {}
    idbWriteState(state.records, state.tombstones, state.pending).catch(function () {});
  }

  function hydrateFromIndexedDb() {
    return idbReadState().then(function (idbState) {
      if (!idbState) return false;
      var idbPend = ensurePendingShape(idbState.pending);
      state.pending = {
        saves: Object.assign({}, idbPend.saves, ensurePendingShape(state.pending).saves),
        deletes: Object.assign({}, idbPend.deletes, ensurePendingShape(state.pending).deletes)
      };
      var res = mergeAuthoritativeState(idbState.records || [], idbState.tombstones || {}, { preferLocal: true });
      if (res.changed) {
        saveToLocalStorage();
        refreshHistoryDom();
      }
      return true;
    }).catch(function () { return false; });
  }

  function broadcastLocalEvent(type, payload) {
    var msg = { type: type, action: type, payload: payload, details: payload, sender: MY_CLIENT_ID, ts: Date.now() };
    try {
      if (typeof window.BroadcastChannel === 'function') {
        var ch = new window.BroadcastChannel(CHANNEL_NAME);
        ch.postMessage(msg);
        ch.close();
      }
    } catch (_) {}
    try {
      if (window.localStorage) {
        window.__ATPL_INTERNAL_STORAGE_WRITE = true;
        window.localStorage.setItem('ATPL_TRIGGER_EVENT', JSON.stringify(msg));
        window.__ATPL_INTERNAL_STORAGE_WRITE = false;
      }
    } catch (_) {
      window.__ATPL_INTERNAL_STORAGE_WRITE = false;
    }
  }

  function notifyToast(msg) {
    if (typeof window.showToast === 'function') {
      try { window.showToast(msg); } catch (_) {}
    }
  }

  function setStatus(msg, tone) {
    state.statusMessage = msg || '';
    state.statusTone = tone || 'info';
  }

  function mergeAuthoritativeState(remoteList, remoteTombstones, opts) {
    opts = opts || {};
    var remoteArr = Array.isArray(remoteList) ? remoteList.map(normalizeRecordShape).filter(Boolean) : [];
    var rTombs = (remoteTombstones && typeof remoteTombstones === 'object') ? remoteTombstones : {};
    var pend = ensurePendingShape(state.pending);

    // 1. Merge tombstones keeping latest deletion timestamp per ID
    var mergedTombs = {};
    function takeTomb(id, tsVal) {
      if (!id || !tsVal) return;
      var nextMs = parseTsMs(tsVal) || Date.now();
      var prevMs = parseTsMs(mergedTombs[id]);
      if (!mergedTombs[id] || nextMs > prevMs) {
        mergedTombs[id] = new Date(nextMs).toISOString();
      }
    }
    Object.keys(state.tombstones || {}).forEach(function (id) { takeTomb(id, state.tombstones[id]); });
    Object.keys(rTombs).forEach(function (id) { takeTomb(id, rTombs[id]); });
    Object.keys(pend.deletes).forEach(function (id) { takeTomb(id, pend.deletes[id]); });

    // 2. Merge records keeping newest updatedAt per ID
    var localMap = {};
    (state.records || []).forEach(function (raw) {
      var r = normalizeRecordShape(raw);
      if (r && r.id) localMap[r.id] = r;
    });
    var remoteMap = {};
    remoteArr.forEach(function (r) {
      if (r && r.id) remoteMap[r.id] = r;
    });

    var allIds = {};
    Object.keys(localMap).forEach(function (id) { allIds[id] = true; });
    Object.keys(remoteMap).forEach(function (id) { allIds[id] = true; });

    var mergedRecords = [];
    var localAhead = false;

    Object.keys(allIds).forEach(function (id) {
      var l = localMap[id] || null;
      var r = remoteMap[id] || null;
      var chosen = null;

      if (l && r) {
        var lTs = parseTsMs(l.updatedAt || l.createdAt);
        var rTs = parseTsMs(r.updatedAt || r.createdAt);
        if (lTs > rTs || (lTs === rTs && (pend.saves[id] || opts.preferLocal))) {
          chosen = l;
          if (lTs > rTs) localAhead = true;
        } else {
          chosen = r;
        }
      } else if (l) {
        chosen = l;
        localAhead = true;
      } else if (r) {
        chosen = r;
      }

      if (!chosen) return;
      var cTs = parseTsMs(chosen.updatedAt || chosen.createdAt);
      var tTs = mergedTombs[id] ? parseTsMs(mergedTombs[id]) : 0;

      if (tTs && (!cTs || tTs >= cTs)) {
        // Tombstone wins; if remote still carries it, remote needs our tombstone push
        if (r && !rTombs[id]) localAhead = true;
        return;
      }
      if (tTs && cTs > tTs) {
        // Record is newer than deletion tombstone -> revive & clean tombstone
        delete mergedTombs[id];
        localAhead = true;
      }
      mergedRecords.push(chosen);
    });

    // Check if we have tombstones remote hasn't recorded yet
    Object.keys(mergedTombs).forEach(function (tid) {
      if (!rTombs[tid] || parseTsMs(mergedTombs[tid]) > parseTsMs(rTombs[tid])) {
        localAhead = true;
      }
    });

    mergedRecords.sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });

    var prevSig = JSON.stringify(state.records || []) + '|' + JSON.stringify(state.tombstones || {});
    var nextSig = JSON.stringify(mergedRecords) + '|' + JSON.stringify(mergedTombs);
    var changed = prevSig !== nextSig;

    state.records = mergedRecords;
    state.tombstones = mergedTombs;

    if (changed) saveToLocalStorage();
    return { changed: changed, localAhead: localAhead };
  }

  function mergeServerRecords(serverList, serverTombstones) {
    return mergeAuthoritativeState(serverList, serverTombstones || {});
  }

  function stripInternalLettersFileFromWindowFiles() {
    try {
      if (Array.isArray(window.FILES)) {
        var targetLow = CLOUD_FILENAME.toLowerCase();
        var had = window.FILES.some(function (f) { return f && String(f.name || '').toLowerCase().trim() === targetLow; });
        if (had) {
          window.FILES = window.FILES.filter(function (f) {
            return !f || String(f.name || '').toLowerCase().trim() !== targetLow;
          });
        }
      }
    } catch (_) {}
  }

  function buildAuthoritativeCloudPayload() {
    return {
      version: 1,
      letters: state.records || [],
      tombstones: state.tombstones || {},
      updatedAt: new Date().toISOString()
    };
  }

  function pushAuthoritativeToCloud() {
    if (activePushPromise) {
      pendingPushQueued = true;
      return activePushPromise;
    }
    state.syncStatus = 'syncing';
    refreshSyncBadgeDom();

    activePushPromise = (async function () {
      var confirmed = false;
      try {
        do {
          pendingPushQueued = false;
          // Read-Modify-Write against latest cloud JSON so we never overwrite another browser's newer letter
          try {
            var dl = await callGoogleBackend('downloadFile', { fileName: CLOUD_FILENAME });
            if (dl && dl.ok && dl.fileBase64) {
              var remoteObj = JSON.parse(b64ToUtf8(dl.fileBase64) || '{}');
              var remoteLetters = Array.isArray(remoteObj.letters) ? remoteObj.letters : (Array.isArray(remoteObj.records) ? remoteObj.records : []);
              var remoteTombs = (remoteObj.tombstones && typeof remoteObj.tombstones === 'object') ? remoteObj.tombstones : {};
              mergeAuthoritativeState(remoteLetters, remoteTombs, { preferLocal: true });
            }
          } catch (_) {}

          var payload = buildAuthoritativeCloudPayload();
          var b64 = utf8ToB64(JSON.stringify(payload));
          var res = await callGoogleBackend('uploadFile', {
            fileName: CLOUD_FILENAME,
            fileBase64: b64,
            mimeType: 'application/json'
          });

          if (res && res.ok) {
            confirmed = true;
            state.pending = { saves: {}, deletes: {} };
            state.lastSyncAt = payload.updatedAt;
            lastSeenDriveFileTs = Date.now();
            saveToLocalStorage();
          }

          // Best-effort Express server sync when available
          if (typeof window.fetch === 'function') {
            try {
              var srvRes = await window.fetch('/api/sync/leave-letters/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: state.records || [], tombstones: state.tombstones || {} })
              });
              if (srvRes && srvRes.ok && !confirmed) {
                var sj = await srvRes.json().catch(function () { return null; });
                if (sj && sj.ok) {
                  confirmed = true;
                  state.pending = { saves: {}, deletes: {} };
                  state.lastSyncAt = new Date().toISOString();
                  saveToLocalStorage();
                }
              }
            } catch (_) {}
          }

          broadcastLocalEvent('leave_letters_synced', { ts: Date.now(), count: (state.records || []).length });
        } while (pendingPushQueued);

        state.syncStatus = confirmed ? 'synced' : (hasPending() ? 'pending' : 'offline');
        refreshHistoryDom();
        return { ok: confirmed, count: (state.records || []).length };
      } catch (err) {
        state.syncStatus = hasPending() ? 'pending' : 'offline';
        refreshSyncBadgeDom();
        return { ok: false, error: err && err.message ? err.message : 'push error' };
      } finally {
        activePushPromise = null;
        pendingPushQueued = false;
      }
    })();

    return activePushPromise;
  }

  function syncNow(force) {
    var now = Date.now();
    if (!force && !hasPending() && (now - lastCloudSyncAtMs < 6000)) {
      return Promise.resolve({ ok: true, throttled: true, count: state.records.length });
    }
    if (activeSyncPromise) return activeSyncPromise;

    state.syncStatus = 'syncing';
    refreshSyncBadgeDom();

    activeSyncPromise = (async function () {
      var cloudReachable = false;
      var shouldPushBack = hasPending();
      try {
        // 1. Pull authoritative JSON from Google Apps Script / Drive
        try {
          var dl = await callGoogleBackend('downloadFile', { fileName: CLOUD_FILENAME });
          if (dl && dl.ok) {
            cloudReachable = true;
            if (dl.fileBase64) {
              var remoteObj = JSON.parse(b64ToUtf8(dl.fileBase64) || '{}');
              var remoteLetters = Array.isArray(remoteObj.letters) ? remoteObj.letters : (Array.isArray(remoteObj.records) ? remoteObj.records : []);
              var remoteTombs = (remoteObj.tombstones && typeof remoteObj.tombstones === 'object') ? remoteObj.tombstones : {};
              var m1 = mergeAuthoritativeState(remoteLetters, remoteTombs);
              if (m1.localAhead) shouldPushBack = true;
            } else if ((state.records || []).length > 0 || Object.keys(state.tombstones || {}).length > 0) {
              shouldPushBack = true;
            }
          }
        } catch (_) {}

        // 2. Also check Express server /api/sync/leave-letters when running on Express/Node
        if (typeof window.fetch === 'function') {
          try {
            var res = await window.fetch('/api/sync/leave-letters', { cache: 'no-store' });
            if (res && res.ok) {
              var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
              if (!ct || ct.indexOf('json') >= 0) {
                var data = await res.json().catch(function () { return null; });
                if (data && data.ok && Array.isArray(data.records)) {
                  cloudReachable = true;
                  var m2 = mergeAuthoritativeState(data.records, data.tombstones || {});
                  if (m2.localAhead) shouldPushBack = true;
                }
              }
            }
          } catch (_) {}
        }

        stripInternalLettersFileFromWindowFiles();

        if (shouldPushBack && (cloudReachable || hasPending() || (state.records || []).length > 0 || Object.keys(state.tombstones || {}).length > 0)) {
          var pRes = await pushAuthoritativeToCloud();
          if (pRes && pRes.ok) cloudReachable = true;
        }

        if (cloudReachable) {
          lastCloudSyncAtMs = Date.now();
          state.lastSyncAt = new Date().toISOString();
          state.syncStatus = hasPending() ? 'pending' : 'synced';
        } else {
          state.syncStatus = hasPending() ? 'pending' : 'idle';
        }

        refreshHistoryDom();
        return { ok: true, synced: cloudReachable, count: state.records.length };
      } catch (err) {
        state.syncStatus = hasPending() ? 'pending' : 'offline';
        refreshSyncBadgeDom();
        return { ok: false, error: err && err.message ? err.message : 'sync error' };
      } finally {
        activeSyncPromise = null;
      }
    })();

    return activeSyncPromise;
  }

  function onDriveFilesMeta(driveFiles) {
    if (!Array.isArray(driveFiles)) return;
    var targetLow = CLOUD_FILENAME.toLowerCase();
    var hit = driveFiles.find(function (df) {
      return df && String(df.name || '').toLowerCase().trim() === targetLow;
    });
    if (!hit) return;
    var remoteTs = parseTsMs(hit.updatedAt);
    if (remoteTs > lastSeenDriveFileTs) {
      lastSeenDriveFileTs = remoteTs;
      syncNow(true);
    }
  }

  function pushRecordToServer(rec) {
    if (typeof window.fetch !== 'function' || !rec || !rec.id) return Promise.resolve();
    return window.fetch('/api/sync/leave-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec)
    }).catch(function () {});
  }

  function deleteRecordOnServer(id) {
    if (typeof window.fetch !== 'function' || !id) return Promise.resolve();
    return window.fetch('/api/sync/leave-letter/' + encodeURIComponent(id), {
      method: 'DELETE'
    }).catch(function () {});
  }

  function recalcFormDates(options) {
    options = options || {};
    var f = state.form;
    f.days = diffDaysInclusive(f.fromDate, f.toDate);
    if (options.forceAutoReturn || !state.returnDateManual) {
      if (f.toDate) {
        f.returnDate = addDaysISO(f.toDate, 1);
      }
    }
  }

  function maybeHindi(val) {
    var s = String(val || '').trim();
    if (!s) return '';
    return state.form.autoHindi ? convertEnglishToHindi(s) : s;
  }

  function applyEmployeeMatchToForm(match) {
    if (!match) return;
    var f = state.form;
    if (f.letterType === 'BANK') {
      f.empName = maybeHindi(match.empName || f.empName);
      f.fatherName = maybeHindi(match.fatherName || f.fatherName);
      f.aadhaarNo = match.aadhaarNo || f.aadhaarNo;
      f.panNo = match.panNo || f.panNo;
      f.permanentAddress = maybeHindi(match.permanentAddress || f.permanentAddress);
      f.designation = match.designation || f.designation;
      f.department = match.department || f.department;
    } else {
      f.empName = match.empName || f.empName;
      f.designation = match.designation || '';
      f.department = match.department || '';
      if (match.fatherName && !f.fatherName) f.fatherName = match.fatherName;
      if (match.aadhaarNo && !f.aadhaarNo) f.aadhaarNo = match.aadhaarNo;
      if (match.panNo && !f.panNo) f.panNo = match.panNo;
      if (match.permanentAddress && !f.permanentAddress) f.permanentAddress = match.permanentAddress;
    }
  }

  function convertBankFieldsToHindiNow() {
    var f = state.form;
    var keys = ['empName', 'fatherName', 'permanentAddress', 'authSignatory', 'signatoryName', 'signatoryDesignation'];
    keys.forEach(function (k) {
      if (f[k]) f[k] = convertEnglishToHindi(f[k]);
    });
  }

  function setFormField(field, value, opts) {
    opts = opts || {};
    var f = state.form;
    var needsFullRender = false;

    if (field === 'letterType') {
      var prevType = f.letterType || 'LEAVE';
      var nextType = (String(value || 'LEAVE').toUpperCase() === 'BANK') ? 'BANK' : 'LEAVE';
      f.letterType = nextType;
      if (nextType !== prevType) {
        // Switching format must never overwrite a saved letter of the previous format
        state.editingId = null;
      }
      var curMatch = f.empCode ? findEmployeeByCode(f.empCode) : null;
      if (nextType === 'BANK') {
        if (curMatch) applyEmployeeMatchToForm(curMatch);
        if (f.autoHindi) convertBankFieldsToHindiNow();
      } else {
        if (curMatch && hasDevanagari(f.empName)) {
          f.empName = curMatch.empName || f.empName;
        }
      }
      needsFullRender = true;
    } else if (field === 'empCode') {
      var nextCode = String(value || '');
      if (state.editingId) {
        var loadedRec = state.records.find(function (r) { return r && r.id === state.editingId; });
        if (loadedRec && loadedRec.empCode && nextCode.trim() && normalizeCode(loadedRec.empCode) !== normalizeCode(nextCode)) {
          state.editingId = null;
        }
      }
      f.empCode = nextCode;
      var match = findEmployeeByCode(f.empCode);
      if (match) {
        applyEmployeeMatchToForm(match);
      }
    } else if (field === 'fromDate') {
      f.fromDate = String(value || '');
      if (f.toDate && f.fromDate && f.toDate < f.fromDate) {
        f.toDate = f.fromDate;
        if (!state.returnDateManual) f.returnDate = addDaysISO(f.toDate, 1);
      }
      recalcFormDates({ forceAutoReturn: !state.returnDateManual });
    } else if (field === 'toDate') {
      f.toDate = String(value || '');
      state.returnDateManual = false;
      recalcFormDates({ forceAutoReturn: true });
    } else if (field === 'returnDate') {
      f.returnDate = String(value || '');
      state.returnDateManual = true;
    } else if (field === 'days') {
      var n = parseInt(value, 10);
      f.days = isFinite(n) && n >= 0 ? n : 0;
    } else if (field === 'letterheadSpace' || field === 'hideBankHeader' || field === 'autoHindi') {
      f[field] = Boolean(value);
      if (field === 'autoHindi' && f[field] && f.letterType === 'BANK') {
        convertBankFieldsToHindiNow();
        needsFullRender = true;
      }
    } else if (field in f) {
      f[field] = String(value == null ? '' : value);
    }

    if (!opts.silent) {
      if (needsFullRender) renderUI();
      else refreshPreviewAndCalculatedDom();
    }
  }

  function resetReturnDateAuto() {
    state.returnDateManual = false;
    recalcFormDates({ forceAutoReturn: true });
    renderUI();
  }

  function renderBankBlankOrValue(val, fallbackLine, autoHindi) {
    var raw = String(val || '').trim();
    if (!raw) {
      return '<span style="display:inline-block;letter-spacing:0;">' + fallbackLine + '</span>';
    }
    var display = autoHindi ? convertEnglishToHindi(raw) : raw;
    return '<span style="font-weight:700;border-bottom:1px solid #000000;padding:0 5px 1px 5px;">' + esc(display) + '</span>';
  }

  function buildBankLetterInnerHtml(rec) {
    rec = rec || state.form;
    var autoHi = rec.autoHindi !== false;
    var useLetterheadSpace = rec.letterheadSpace !== false;
    var hideHeader = !!rec.hideBankHeader;

    var dateTxt = parseISODateParts(rec.letterDate) ? formatDateDDMMYYYY(rec.letterDate) : '';
    var dateHtml = dateTxt
      ? '<span style="font-weight:700;border-bottom:1px solid #000000;padding:0 6px 1px 6px;">' + esc(dateTxt) + '</span>'
      : '_______________';

    var empNameDisplay = String(rec.empName || '').trim();
    if (empNameDisplay && autoHi) empNameDisplay = convertEnglishToHindi(empNameDisplay);

    var fatherDisplay = String(rec.fatherName || '').trim();
    if (fatherDisplay && autoHi) fatherDisplay = convertEnglishToHindi(fatherDisplay);

    var aadhaarDisplay = String(rec.aadhaarNo || '').trim();
    var panDisplay = String(rec.panNo || '').trim().toUpperCase();

    var addrRaw = String(rec.permanentAddress || '').trim();
    if (addrRaw && autoHi) addrRaw = convertEnglishToHindi(addrRaw);

    var authSigDisplay = String(rec.authSignatory || '').trim();
    if (authSigDisplay && autoHi) authSigDisplay = convertEnglishToHindi(authSigDisplay);

    var sigNameDisplay = String(rec.signatoryName || '').trim();
    if (sigNameDisplay && autoHi) sigNameDisplay = convertEnglishToHindi(sigNameDisplay);

    var sigDesigDisplay = String(rec.signatoryDesignation || '').trim();
    if (sigDesigDisplay && autoHi) sigDesigDisplay = convertEnglishToHindi(sigDesigDisplay);

    var topSpacerHtml = useLetterheadSpace
      ? (
        '<div class="atpl-letterhead-spacer" style="margin:0;padding:0;">' +
          '<div style="height:22px;line-height:22px;">&nbsp;</div>' +
          '<div style="height:22px;line-height:22px;">&nbsp;</div>' +
          '<div style="height:22px;line-height:22px;">&nbsp;</div>' +
          '<div style="height:22px;line-height:22px;">&nbsp;</div>' +
          '<div style="height:22px;line-height:22px;">&nbsp;</div>' +
        '</div>'
      )
      : '';

    var companyHeaderHtml = hideHeader
      ? ''
      : (
        '<div style="text-align:center;margin-bottom:12px;">' +
          '<div style="font-size:16px;font-weight:700;letter-spacing:0.3px;">ARORA TEXTILES PRIVATE LIMITED</div>' +
          '<div style="font-size:13px;font-weight:600;margin-top:2px;">खारा, बीकानेर, राजस्थान</div>' +
        '</div>'
      );

    var addrLinesHtml = '';
    if (addrRaw) {
      var parts = addrRaw.split(/\r?\n/);
      if (parts.length >= 2) {
        addrLinesHtml =
          '<div style="margin-top:4px;font-weight:700;border-bottom:1px solid #000000;padding-bottom:2px;min-height:18px;">' + esc(parts[0]) + '</div>' +
          '<div style="margin-top:6px;font-weight:700;border-bottom:1px solid #000000;padding-bottom:2px;min-height:18px;">' + esc(parts.slice(1).join(', ')) + '</div>';
      } else {
        addrLinesHtml =
          '<div style="margin-top:4px;font-weight:700;border-bottom:1px solid #000000;padding-bottom:2px;min-height:18px;">' + esc(addrRaw) + '</div>' +
          '<div style="margin-top:6px;border-bottom:1px solid #000000;height:16px;">&nbsp;</div>';
      }
    } else {
      addrLinesHtml =
        '<div style="margin-top:4px;">________________________________________</div>' +
        '<div style="margin-top:4px;">________________________________________</div>';
    }

    return (
      '<div class="atpl-bank-letter-sheet" style="font-family:\'Mangal\',\'Nirmala UI\',\'Noto Sans Devanagari\',\'Times New Roman\',Times,serif;color:#000000;background:#ffffff;font-size:13px;line-height:1.5;">' +
        topSpacerHtml +
        companyHeaderHtml +
        '<div style="text-align:right;margin-bottom:10px;">पत्र लिखने की दिनांक: ' + dateHtml + '</div>' +
        '<div style="margin-bottom:10px;line-height:1.45;">' +
          '<div>सेवा में,</div>' +
          '<div>शाखा प्रबंधक महोदय,</div>' +
          '<div>भारतीय स्टेट बैंक (SBI)</div>' +
          '<div>खारा शाखा, बीकानेर, राजस्थान।</div>' +
        '</div>' +
        '<div style="font-weight:700;margin-bottom:10px;">विषय: बैंक खाता खुलवाने हेतु अनुरोध पत्र।</div>' +
        '<div style="margin-bottom:8px;">महोदय,</div>' +
        '<p style="margin:0 0 8px 0;text-align:justify;">' +
          'सविनय निवेदन है कि श्री ' + renderBankBlankOrValue(empNameDisplay, '__________________________', false) +
          ', पुत्र श्री ' + renderBankBlankOrValue(fatherDisplay, '__________________________', false) +
          ', हमारी कंपनी Arora Textiles Private Limited में काफी लंबे समय से कार्यरत हैं।' +
        '</p>' +
        '<p style="margin:0 0 8px 0;text-align:justify;">' +
          'उक्त कर्मचारी वर्तमान में हमारी फैक्ट्री परिसर में कंपनी द्वारा उपलब्ध करवाए गए कर्मचारी आवास (स्टाफ क्वार्टर) में निवास कर रहे हैं।' +
        '</p>' +
        '<p style="margin:0 0 10px 0;text-align:justify;">' +
          'अतः आपसे विनम्र अनुरोध है कि कृपया उक्त कर्मचारी का आपके बैंक की खारा शाखा में बचत खाता (Savings Account) खोलने की कृपा करें। बैंक खाता खोलने हेतु आवश्यक प्रक्रिया में हमारा सहयोग प्रदान करने का कष्ट करें।' +
        '</p>' +
        '<div style="font-weight:700;margin-bottom:6px;">कर्मचारी का विवरण:</div>' +
        '<div style="padding-left:10px;margin-bottom:12px;line-height:1.65;">' +
          '<div>1.&nbsp;&nbsp;कर्मचारी का नाम: ' + renderBankBlankOrValue(empNameDisplay, '__________________________', false) + '</div>' +
          '<div>2.&nbsp;&nbsp;पिता का नाम: ' + renderBankBlankOrValue(fatherDisplay, '__________________________', false) + '</div>' +
          '<div>3.&nbsp;&nbsp;आधार कार्ड नंबर: ' + renderBankBlankOrValue(aadhaarDisplay, '__________________________', false) + '</div>' +
          '<div>4.&nbsp;&nbsp;पैन कार्ड नंबर: ' + renderBankBlankOrValue(panDisplay, '__________________________', false) + '</div>' +
          '<div>5.&nbsp;&nbsp;स्थायी पता:' + addrLinesHtml + '</div>' +
        '</div>' +
        '<p style="margin:0 0 10px 0;text-align:justify;">' +
          'अतः आपसे पुनः अनुरोध है कि कृपया कर्मचारी का बैंक खाता खोलने की आवश्यक कार्यवाही करने का कष्ट करें।' +
        '</p>' +
        '<div style="margin-bottom:12px;">धन्यवाद।</div>' +
        '<div style="line-height:1.65;">' +
          '<div>भवदीय,</div>' +
          '<div style="font-weight:700;margin-bottom:14px;">Arora Textiles Private Limited की ओर से</div>' +
          '<div>अधिकृत हस्ताक्षरकर्ता: ' + renderBankBlankOrValue(authSigDisplay, '__________________', false) + '</div>' +
          '<div>नाम: ' + renderBankBlankOrValue(sigNameDisplay, '__________________', false) + '</div>' +
          '<div>पद: ' + renderBankBlankOrValue(sigDesigDisplay, '__________________', false) + '</div>' +
          '<div style="margin-top:12px;font-weight:700;">कंपनी की मोहर एवं हस्ताक्षर</div>' +
        '</div>' +
      '</div>'
    );
  }

  function buildLetterInnerHtml(rec) {
    rec = rec || state.form;
    if (rec && rec.letterType === 'BANK') {
      return buildBankLetterInnerHtml(rec);
    }

    var empCode = String(rec.empCode || '').trim() || '_____';
    var empName = String(rec.empName || '').trim() || 'Employee Name';
    var designation = String(rec.designation || '').trim() || '__________';
    var department = String(rec.department || '').trim() || '__________';
    var days = Number(rec.days || diffDaysInclusive(rec.fromDate, rec.toDate) || 0);
    var daysWord = days === 1 ? 'Day' : 'Days';
    var letterDateTxt = formatDateDDMMYY(rec.letterDate);
    var fromTxt = formatDateDDMMYYYY(rec.fromDate);
    var toTxt = formatDateDDMMYYYY(rec.toDate);
    var returnTxt = formatDateDDMMYYYY(rec.returnDate || addDaysISO(rec.toDate, 1));
    var reasonTxt = String(rec.reason || 'some personal reason').trim() || 'some personal reason';
    var signedBy = String(rec.signedBy || 'Sarthak ji').trim();

    // Slightly smaller text (12px body) with balanced A4 spacing filling ~70-80% of page cleanly
    return (
      '<div class="atpl-letter-sheet" style="font-family:\'Times New Roman\',Times,serif;color:#000000;background:#ffffff;line-height:1.55;font-size:12px;">' +
        '<div style="text-align:center;font-weight:700;margin-bottom:24px;">' +
          '<div style="font-size:16.5px;letter-spacing:0.3px;margin-bottom:4px;">ARORA TEXTILES PVT LTD</div>' +
          '<div style="font-size:12px;margin-bottom:3px;">(Manufacturers of Suppliers of Carpet Woollen Yarn)</div>' +
          '<div style="font-size:12px;margin-bottom:3px;">Add:-E-90,91, IGC, Khara-334601, Bikaner (Rajasthan)</div>' +
          '<div style="font-size:12px;">E-mail:-arorawool@gmail.com:, Mobile No:-9858121113</div>' +
        '</div>' +

        '<div style="text-align:right;font-size:12px;margin-bottom:18px;">' + esc(letterDateTxt) + '</div>' +

        '<div style="font-weight:700;font-size:12px;line-height:1.45;margin-bottom:20px;">' +
          '<div>The Respected Directors</div>' +
          '<div>Arora Textiles Pvt Ltd</div>' +
          '<div>Khara-334601, Bikaner (Rajasthan)</div>' +
        '</div>' +

        '<div style="font-size:12px;margin-bottom:12px;">From,</div>' +

        '<div style="font-size:12px;line-height:1.65;margin-bottom:26px;">' +
          '<div>' + esc(empName) + '</div>' +
          '<div><b>Employee ID:</b> ' + esc(empCode) + '</div>' +
          '<div><b>Designation:</b> ' + esc(designation) + '</div>' +
          '<div><b>Department:</b> ' + esc(department) + '</div>' +
        '</div>' +

        '<div style="text-align:center;font-weight:700;text-decoration:underline;font-size:12.5px;margin-bottom:18px;">Subject: Leave Application</div>' +

        '<div style="font-size:12px;margin-bottom:14px;">Dear Sir,</div>' +

        '<p style="margin:0 0 15px 0;font-size:12px;text-align:left;">' +
          'With humble request, I am writing this letter to inform you and to get permission to take <b>' + esc(days) + ' ' + esc(daysWord) + '</b> of leave from <b>' + esc(fromTxt) + '</b> to <b>' + esc(toTxt) + '</b> because of ' + esc(reasonTxt) + '.' +
        '</p>' +

        '<p style="margin:0 0 15px 0;font-size:12px;text-align:left;">' +
          'I feel confident that my team members should be able to continue the exceptional work during my absence.' +
        '</p>' +

        '<p style="margin:0 0 15px 0;font-size:12px;text-align:left;">' +
          'I hope you will understand my situation and grant me leave for <b>' + esc(days) + ' ' + esc(daysWord) + '</b>. I will return to work immediately after the leave i.e., on <b>' + esc(returnTxt) + '</b>' +
        '</p>' +

        '<p style="margin:0 0 15px 0;font-size:12px;text-align:left;">In case of any emergency, I will be available on my mobile.</p>' +

        '<p style="margin:0 0 16px 0;font-size:12px;text-align:left;">I shall be obliged to you in this matter.</p>' +

        '<div style="text-align:center;font-weight:700;text-decoration:underline;font-size:12.5px;margin:20px 0 64px 0;">(Thanking You)</div>' +

        '<table style="width:100%;border-collapse:collapse;font-family:\'Times New Roman\',Times,serif;font-size:12px;color:#000000;">' +
          '<tr>' +
            '<td style="width:33%;text-align:center;vertical-align:top;border:none;padding:0;">' +
              '<div>Sincerely</div>' +
              '<div style="margin-top:3px;">(' + esc(empName) + ')</div>' +
            '</td>' +
            '<td style="width:34%;text-align:center;vertical-align:top;border:none;padding:0;">' +
              '<div>Arora Textiles Pvt Ltd</div>' +
              '<div style="margin-top:3px;">(Director)</div>' +
              (signedBy ? '<div style="margin-top:3px;font-size:11px;">(' + esc(signedBy) + ')</div>' : '') +
            '</td>' +
            '<td style="width:33%;text-align:center;vertical-align:top;border:none;padding:0;">' +
              '<div>HR Department</div>' +
              '<div style="margin-top:3px;">(HOD)</div>' +
            '</td>' +
          '</tr>' +
        '</table>' +
      '</div>'
    );
  }

  function buildDownloadDocumentHtml(rec, mode) {
    rec = rec || state.form;
    var isWord = mode === 'word';
    var isBank = rec && rec.letterType === 'BANK';
    var inner = buildLetterInnerHtml(rec);
    var titlePrefix = isBank ? 'Bank Account Opening Letter - ' : 'Leave Application - ';
    var fontStack = isBank
      ? '"Mangal", "Nirmala UI", "Noto Sans Devanagari", "Times New Roman", Times, serif'
      : '"Times New Roman", Times, serif';
    var pageMargin = isBank ? '14mm 18mm' : '18mm 20mm';
    var wordMargin = isBank ? '14mm 18mm 14mm 18mm' : '18mm 20mm 18mm 20mm';

    if (isWord) {
      return (
        '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
        '<head><meta charset="utf-8"><title>' + titlePrefix + esc(rec.empName || rec.empCode || 'Employee') + '</title>' +
        '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
        '<style>' +
        '@page Section1 { size: 210mm 297mm; margin: ' + wordMargin + '; }' +
        'div.Section1 { page: Section1; font-family: ' + fontStack + '; }' +
        'body { font-family: ' + fontStack + '; margin: 0; color: #000; }' +
        'p { margin: 0 0 10px 0; }' +
        '</style></head>' +
        '<body><div class="Section1">' + inner + '</div></body></html>'
      );
    }
    return (
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>' + titlePrefix + esc(rec.empName || rec.empCode || 'Employee') + '</title>' +
      '<style>' +
      '@page { size: A4; margin: ' + pageMargin + '; }' +
      'html, body { background: #fff; color: #000; font-family: ' + fontStack + '; margin: 0; padding: 0; }' +
      '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }' +
      '</style></head><body>' + inner + '</body></html>'
    );
  }

  function hasAnyBankInput(f) {
    f = f || state.form;
    return Boolean(
      String(f.empCode || '').trim() ||
      String(f.empName || '').trim() ||
      String(f.fatherName || '').trim() ||
      String(f.aadhaarNo || '').trim() ||
      String(f.panNo || '').trim() ||
      String(f.permanentAddress || '').trim()
    );
  }

  function buildRecordPayloadFromForm() {
    var f = state.form;
    var isBank = f.letterType === 'BANK';
    var curType = isBank ? 'BANK' : 'LEAVE';
    var days = isBank ? 0 : (diffDaysInclusive(f.fromDate, f.toDate) || Number(f.days || 0));
    var now = new Date().toISOString();
    var codeNorm = normalizeCode(f.empCode);
    var rawNameNorm = normalizeNameKey(f.empName);
    var hiNameNorm = isBank ? normalizeNameKey(convertEnglishToHindi(f.empName)) : rawNameNorm;

    var existing = null;
    if (state.editingId) {
      var cand = state.records.find(function (r) { return r && r.id === state.editingId; }) || null;
      if (cand && (cand.letterType || 'LEAVE') === curType) {
        var candCode = normalizeCode(cand.empCode);
        if (!candCode || !codeNorm || candCode === codeNorm) {
          existing = cand;
        }
      }
    }
    if (!existing) {
      if (isBank) {
        existing = state.records.find(function (r) {
          if (!r || (r.letterType || 'LEAVE') !== 'BANK' || r.letterDate !== f.letterDate) return false;
          var rCode = normalizeCode(r.empCode);
          if (codeNorm && rCode) return rCode === codeNorm;
          if (!codeNorm && !rCode) {
            var rName = normalizeNameKey(r.empName);
            if (rName && (rName === rawNameNorm || rName === hiNameNorm)) return true;
            if (!rName && !rawNameNorm && String(f.aadhaarNo || '').trim() && String(r.aadhaarNo || '').trim() === String(f.aadhaarNo || '').trim()) return true;
          }
          return false;
        }) || null;
      } else {
        existing = state.records.find(function (r) {
          if (!r || (r.letterType || 'LEAVE') !== curType) return false;
          if (r.fromDate !== f.fromDate || r.toDate !== f.toDate) return false;
          var rCode = normalizeCode(r.empCode);
          if (codeNorm && rCode) return rCode === codeNorm;
          if (!codeNorm && !rCode && rawNameNorm) return normalizeNameKey(r.empName) === rawNameNorm;
          return false;
        }) || null;
      }
    }

    var id = existing ? existing.id : ('ltr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    var finalEmpName = isBank && f.autoHindi ? convertEnglishToHindi(f.empName) : String(f.empName || '').trim();
    var finalFatherName = isBank && f.autoHindi ? convertEnglishToHindi(f.fatherName) : String(f.fatherName || '').trim();
    var finalAddr = isBank && f.autoHindi ? convertEnglishToHindi(f.permanentAddress) : String(f.permanentAddress || '').trim();
    var finalAuthSig = isBank && f.autoHindi ? convertEnglishToHindi(f.authSignatory) : String(f.authSignatory || '').trim();
    var finalSigName = isBank && f.autoHindi ? convertEnglishToHindi(f.signatoryName) : String(f.signatoryName || '').trim();
    var finalSigDesig = isBank && f.autoHindi ? convertEnglishToHindi(f.signatoryDesignation) : String(f.signatoryDesignation || '').trim();

    return {
      id: id,
      letterType: curType,
      letterDate: f.letterDate || todayISO(),
      empCode: String(f.empCode || '').trim(),
      empName: finalEmpName,
      designation: String(f.designation || '').trim(),
      department: String(f.department || '').trim(),
      fromDate: isBank ? '' : (f.fromDate || ''),
      toDate: isBank ? '' : (f.toDate || ''),
      days: days,
      returnDate: isBank ? '' : (f.returnDate || addDaysISO(f.toDate, 1)),
      returnDateManual: isBank ? false : !!state.returnDateManual,
      reason: isBank ? 'Bank Account Opening (SBI)' : (String(f.reason || 'some personal reason').trim() || 'some personal reason'),
      signedBy: String(f.signedBy || 'Sarthak ji').trim(),
      fatherName: finalFatherName,
      aadhaarNo: String(f.aadhaarNo || '').trim(),
      panNo: String(f.panNo || '').trim().toUpperCase(),
      permanentAddress: finalAddr,
      authSignatory: finalAuthSig,
      signatoryName: finalSigName,
      signatoryDesignation: finalSigDesig,
      letterheadSpace: f.letterheadSpace !== false,
      hideBankHeader: !!f.hideBankHeader,
      autoHindi: f.autoHindi !== false,
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };
  }

  function validateForm(opts) {
    opts = opts || {};
    var f = state.form;
    if (f.letterType === 'BANK') {
      if (!opts.allowBlank && !hasAnyBankInput(f)) {
        setStatus('Bank Letter save karne ke liye kam se kam Employee Name, Emp Code, Father Name ya Aadhaar daaliye.', 'error');
        return false;
      }
      return true;
    }

    if (!String(f.empCode || '').trim() && !String(f.empName || '').trim()) {
      setStatus('Employee Code ya Employee Name daaliye (ya Employee Master list se select karein).', 'error');
      return false;
    }
    if (!String(f.empName || '').trim()) {
      setStatus('Employee Name zaroori hai.', 'error');
      return false;
    }
    if (!parseISODateParts(f.fromDate) || !parseISODateParts(f.toDate)) {
      setStatus('Valid Leave From Date aur To Date select karein.', 'error');
      return false;
    }
    var days = diffDaysInclusive(f.fromDate, f.toDate);
    if (days <= 0) {
      setStatus('Leave To Date, From Date ke barabar ya uske baad honi chahiye.', 'error');
      return false;
    }
    return true;
  }

  function saveCurrentLetter(opts) {
    opts = opts || {};
    if (!validateForm({ allowBlank: Boolean(opts.allowBlank) })) {
      renderUI();
      return null;
    }
    var payload = buildRecordPayloadFromForm();
    delete state.tombstones[payload.id];
    var idx = -1;
    for (var i = 0; i < state.records.length; i++) {
      if (state.records[i] && state.records[i].id === payload.id) { idx = i; break; }
    }
    if (idx >= 0) state.records[idx] = payload;
    else state.records.unshift(payload);

    state.records.sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
    });

    state.editingId = payload.id;
    setPendingSave(payload.id, payload.updatedAt);
    state.syncStatus = 'pending';
    saveToLocalStorage();
    broadcastLocalEvent('leave_letter_saved', payload);
    pushRecordToServer(payload);
    pushAuthoritativeToCloud();

    if (!opts.quiet) {
      var msg = payload.letterType === 'BANK'
        ? ('Bank Letter saved & syncing (' + (payload.empName || payload.empCode || 'Draft') + ').')
        : ('Leave record saved & syncing (' + (payload.empName || payload.empCode) + ' · ' + payload.days + ' Days).');
      setStatus(msg, 'success');
      notifyToast(msg);
      renderUI();
    } else {
      refreshHistoryDom();
    }
    return payload;
  }

  function sanitizeFilenamePart(s) {
    return String(s || 'Employee').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Employee';
  }

  function downloadRecordDoc(rec) {
    if (!rec) {
      if (state.form.letterType === 'BANK' && !hasAnyBankInput(state.form)) {
        rec = buildRecordPayloadFromForm();
      } else {
        rec = saveCurrentLetter({ quiet: true });
      }
    }
    if (!rec) {
      renderUI();
      return false;
    }
    var html = buildDownloadDocumentHtml(rec, 'word');
    var prefix = rec.letterType === 'BANK' ? 'Bank_Account_Letter_' : 'Leave_Application_';
    var datePart = rec.letterType === 'BANK' ? (rec.letterDate || todayISO()) : (rec.fromDate || todayISO());
    var filename = prefix + sanitizeFilenamePart(rec.empCode || 'SBI') + '_' + sanitizeFilenamePart(rec.empName || 'Form') + '_' + datePart + '.doc';

    try {
      if (typeof window.Blob === 'function' && window.URL && typeof window.URL.createObjectURL === 'function' && window.document && window.document.createElement) {
        var blob = new window.Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
        var url = window.URL.createObjectURL(blob);
        var a = window.document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        window.document.body.appendChild(a);
        a.click();
        window.document.body.removeChild(a);
        setTimeout(function () {
          try { window.URL.revokeObjectURL(url); } catch (_) {}
        }, 1500);
      }
      setStatus('Downloaded ' + filename + ' & saved to History.', 'success');
      notifyToast('Letter downloaded: ' + filename);
      renderUI();
      return { ok: true, filename: filename, html: html };
    } catch (err) {
      setStatus('Download error: ' + (err && err.message ? err.message : 'failed'), 'error');
      renderUI();
      return false;
    }
  }

  function printRecordLetter(rec) {
    if (!rec) {
      if (state.form.letterType === 'BANK' && !hasAnyBankInput(state.form)) {
        rec = buildRecordPayloadFromForm();
      } else {
        rec = saveCurrentLetter({ quiet: true });
      }
    }
    if (!rec) {
      renderUI();
      return false;
    }
    var docHtml = buildDownloadDocumentHtml(rec, 'print');
    try {
      var doc = window.document;
      var old = doc.getElementById('atplLetterPrintFrame');
      if (old && old.parentNode) old.parentNode.removeChild(old);

      var iframe = doc.createElement('iframe');
      iframe.id = 'atplLetterPrintFrame';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      doc.body.appendChild(iframe);

      var cw = iframe.contentWindow;
      var cdoc = cw ? cw.document : iframe.contentDocument;
      if (cdoc) {
        cdoc.open();
        cdoc.write(docHtml);
        cdoc.close();
      }
      setTimeout(function () {
        try {
          if (cw) {
            cw.focus();
            cw.print();
          }
        } catch (_) {}
      }, 150);

      setStatus('Print / Save PDF ready (' + (rec.empName || 'Bank Letter') + ').', 'success');
      renderUI();
      return true;
    } catch (err) {
      setStatus('Print preview failed: ' + (err && err.message ? err.message : 'error'), 'error');
      renderUI();
      return false;
    }
  }

  function loadRecordIntoForm(id) {
    var rec = state.records.find(function (r) { return r && r.id === id; });
    if (!rec) return false;
    state.editingId = rec.id;
    state.returnDateManual = !!rec.returnDateManual;
    state.form = {
      letterType: rec.letterType || 'LEAVE',
      letterDate: rec.letterDate || todayISO(),
      empCode: rec.empCode || '',
      empName: rec.empName || '',
      designation: rec.designation || '',
      department: rec.department || '',
      fromDate: rec.fromDate || todayISO(),
      toDate: rec.toDate || todayISO(),
      days: Number(rec.days || diffDaysInclusive(rec.fromDate, rec.toDate) || 0),
      returnDate: rec.returnDate || addDaysISO(rec.toDate, 1),
      reason: rec.reason || 'some personal reason',
      signedBy: rec.signedBy || 'Sarthak ji',
      fatherName: rec.fatherName || '',
      aadhaarNo: rec.aadhaarNo || '',
      panNo: rec.panNo || '',
      permanentAddress: rec.permanentAddress || '',
      authSignatory: rec.authSignatory || '',
      signatoryName: rec.signatoryName || '',
      signatoryDesignation: rec.signatoryDesignation || '',
      letterheadSpace: rec.letterheadSpace !== false,
      hideBankHeader: !!rec.hideBankHeader,
      autoHindi: rec.autoHindi !== false
    };
    setStatus('Loaded historical ' + (state.form.letterType === 'BANK' ? 'bank letter' : 'leave letter') + ' for ' + (rec.empName || rec.empCode) + '.', 'info');
    renderUI();
    return true;
  }

  function startNewLetter() {
    var keepType = state.form.letterType || 'LEAVE';
    var keepCode = state.form.empCode;
    var keepName = state.form.empName;
    var keepDesig = state.form.designation;
    var keepDept = state.form.department;
    var keepSigned = state.form.signedBy || 'Sarthak ji';
    var keepFather = state.form.fatherName || '';
    var keepAadhaar = state.form.aadhaarNo || '';
    var keepPan = state.form.panNo || '';
    var keepAddr = state.form.permanentAddress || '';
    var keepLetterhead = state.form.letterheadSpace !== false;
    var keepHideHdr = !!state.form.hideBankHeader;
    var keepAutoHi = state.form.autoHindi !== false;
    var td = todayISO();
    state.editingId = null;
    state.returnDateManual = false;
    state.form = {
      letterType: keepType,
      letterDate: td,
      empCode: keepCode,
      empName: keepName,
      designation: keepDesig,
      department: keepDept,
      fromDate: td,
      toDate: td,
      days: 1,
      returnDate: addDaysISO(td, 1),
      reason: 'some personal reason',
      signedBy: keepSigned,
      fatherName: keepFather,
      aadhaarNo: keepAadhaar,
      panNo: keepPan,
      permanentAddress: keepAddr,
      authSignatory: '',
      signatoryName: '',
      signatoryDesignation: '',
      letterheadSpace: keepLetterhead,
      hideBankHeader: keepHideHdr,
      autoHindi: keepAutoHi
    };
    setStatus('New ' + (keepType === 'BANK' ? 'bank letter' : 'leave letter') + ' ready.', 'info');
    renderUI();
  }

  function deleteRecord(id) {
    if (!id) return false;
    var existing = state.records.find(function (r) { return r && r.id === id; });
    var exTs = existing ? parseTsMs(existing.updatedAt || existing.createdAt) : 0;
    var deletedAt = new Date(Math.max(Date.now(), exTs + 1000)).toISOString();
    state.tombstones[id] = deletedAt;
    state.records = state.records.filter(function (r) { return r && r.id !== id; });
    if (state.editingId === id) state.editingId = null;
    setPendingDelete(id, deletedAt);
    state.syncStatus = 'pending';
    saveToLocalStorage();
    broadcastLocalEvent('leave_letter_deleted', { id: id, deleted_at: deletedAt });
    deleteRecordOnServer(id);
    pushAuthoritativeToCloud();
    setStatus('Record deleted from history & syncing.', 'info');
    renderUI();
    return true;
  }

  function isRecordActive(r) {
    if (!r || !r.id) return false;
    var tVal = state.tombstones[r.id];
    if (!tVal) return true;
    var rTs = parseTsMs(r.updatedAt || r.createdAt);
    var tTs = parseTsMs(tVal);
    return rTs > tTs;
  }

  function getEmployeeHistory(empCode, optEmpName) {
    var norm = normalizeCode(empCode);
    var nameNorm = normalizeNameKey(optEmpName);
    if (!norm && !nameNorm) return [];
    return state.records.filter(function (r) {
      if (!isRecordActive(r)) return false;
      if (norm && normalizeCode(r.empCode) === norm) return true;
      if (!norm && nameNorm && normalizeNameKey(r.empName) === nameNorm) return true;
      return false;
    }).sort(function (a, b) {
      return String(b.updatedAt || b.fromDate || b.letterDate || '').localeCompare(String(a.updatedAt || a.fromDate || a.letterDate || ''));
    });
  }

  function getFilteredHistory() {
    var hasCode = Boolean(String(state.form.empCode || '').trim());
    var hasName = Boolean(String(state.form.empName || '').trim());
    var list = (state.historyScope === 'employee' && (hasCode || hasName))
      ? getEmployeeHistory(state.form.empCode, state.form.empName)
      : state.records.filter(isRecordActive);

    if (state.historyTypeFilter && state.historyTypeFilter !== 'ALL') {
      list = list.filter(function (r) {
        return (r.letterType || 'LEAVE') === state.historyTypeFilter;
      });
    }

    var q = String(state.historySearch || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(function (r) {
      return (
        String(r.empCode || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.empName || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.department || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.designation || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.reason || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.signedBy || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.aadhaarNo || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.panNo || '').toLowerCase().indexOf(q) >= 0 ||
        String(r.letterType || '').toLowerCase().indexOf(q) >= 0
      );
    });
  }

  function ensureStyles() {
    var doc = window.document;
    if (!doc || !doc.head || doc.getElementById('atpl-letters-v1-style')) return;
    var s = doc.createElement('style');
    s.id = 'atpl-letters-v1-style';
    s.textContent = [
      '#letterModuleContainer{font-family:"Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a;padding:18px 22px 32px;background:#f8fafc;min-height:100%;}',
      '.ltr-shell{max-width:1440px;margin:0 auto;display:flex;flex-direction:column;gap:16px;}',
      '.ltr-topbar{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;}',
      '.ltr-title{font-size:18px;font-weight:800;letter-spacing:-0.3px;color:#0f172a;margin:0;}',
      '.ltr-sub{font-size:12px;color:#64748b;margin-top:2px;}',
      '.ltr-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
      '.ltr-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid #cbd5e1;background:#ffffff;color:#1e293b;transition:background .15s,border-color .15s;}',
      '.ltr-btn:hover{background:#f1f5f9;border-color:#94a3b8;}',
      '.ltr-btn-primary{background:#4f46e5;border-color:#4f46e5;color:#ffffff;}',
      '.ltr-btn-primary:hover{background:#4338ca;border-color:#4338ca;}',
      '.ltr-btn-dark{background:#0f172a;border-color:#0f172a;color:#ffffff;}',
      '.ltr-btn-dark:hover{background:#1e293b;}',
      '.ltr-btn-xs{padding:4px 8px;font-size:11px;border-radius:6px;}',
      '.ltr-status{padding:9px 14px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid #cbd5e1;background:#ffffff;color:#334155;}',
      '.ltr-status.success{background:#f0fdf4;border-color:#bbf7d0;color:#166534;}',
      '.ltr-status.error{background:#fef2f2;border-color:#fecaca;color:#991b1b;}',
      '.ltr-grid{display:grid;grid-template-columns:minmax(360px,460px) minmax(420px,1fr);gap:16px;align-items:start;}',
      '@media(max-width:1180px){.ltr-grid{grid-template-columns:1fr;}}',
      '.ltr-col{display:flex;flex-direction:column;gap:16px;}',
      '.ltr-panel{background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;}',
      '.ltr-panel-head{padding:12px 16px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#ffffff;}',
      '.ltr-panel-title{font-size:13px;font-weight:800;color:#0f172a;}',
      '.ltr-panel-body{padding:16px;}',
      '.ltr-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
      '.ltr-field-full{grid-column:1 / -1;}',
      '.ltr-lbl{display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.3px;}',
      '.ltr-input,.ltr-select,.ltr-textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;color:#0f172a;background:#ffffff;font-variant-numeric:tabular-nums;}',
      '.ltr-textarea{resize:vertical;min-height:58px;font-family:inherit;}',
      '.ltr-input:focus,.ltr-select:focus,.ltr-textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,0.12);}',
      '.ltr-check-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;font-size:12px;color:#334155;}',
      '.ltr-check-row label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;}',
      '.ltr-days-box{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;font-variant-numeric:tabular-nums;}',
      '.ltr-days-num{font-size:18px;font-weight:800;color:#4f46e5;}',
      '.ltr-emp-wrap{position:relative;}',
      '.ltr-suggest{position:absolute;left:0;right:0;top:100%;margin-top:4px;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 10px 25px rgba(15,23,42,0.12);z-index:40;max-height:220px;overflow-y:auto;display:none;}',
      '.ltr-suggest.open{display:block;}',
      '.ltr-suggest-item{padding:8px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:12px;display:flex;justify-content:space-between;gap:8px;}',
      '.ltr-suggest-item:hover{background:#f5f3ff;}',
      '.ltr-paper-wrap{background:#f1f5f9;padding:18px;display:flex;justify-content:center;overflow-x:auto;}',
      '.ltr-paper{width:100%;max-width:740px;min-height:820px;background:#ffffff;border:1px solid #cbd5e1;padding:38px 46px;box-shadow:0 4px 16px rgba(15,23,42,0.06);box-sizing:border-box;}',
      '.ltr-hist-tabs{display:flex;gap:6px;}',
      '.ltr-tab-btn{padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;border:1px solid #cbd5e1;background:#ffffff;color:#475569;cursor:pointer;}',
      '.ltr-tab-btn.active{background:#0f172a;border-color:#0f172a;color:#ffffff;}',
      '.ltr-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;}',
      '.ltr-kpi{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#f8fafc;}',
      '.ltr-kpi-v{font-size:17px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums;}',
      '.ltr-kpi-l{font-size:11px;color:#64748b;margin-top:2px;}',
      '.ltr-table-wrap{overflow-x:auto;}',
      '.ltr-table{width:100%;border-collapse:collapse;font-size:12px;}',
      '.ltr-table th{text-align:left;padding:8px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:700;font-size:11px;white-space:nowrap;}',
      '.ltr-table td{padding:9px 10px;border-bottom:1px solid #f1f5f9;color:#0f172a;vertical-align:middle;font-variant-numeric:tabular-nums;}',
      '.ltr-table tr:hover td{background:#f8fafc;}'
    ].join('');
    doc.head.appendChild(s);
  }

  function syncBadgeTextAndTone() {
    var pendCount = getPendingCount();
    if (state.syncStatus === 'syncing') return { text: '☁ Syncing...', bg: '#eff6ff', fg: '#1d4ed8', bd: '#bfdbfe' };
    if (pendCount > 0 || state.syncStatus === 'pending') return { text: '☁ Pending (' + pendCount + ')', bg: '#fffbeb', fg: '#b45309', bd: '#fde68a' };
    if (state.syncStatus === 'synced') return { text: '☁ Synced', bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0' };
    if (state.syncStatus === 'offline') return { text: '☁ Offline Saved', bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' };
    return { text: '☁ Ready', bg: '#f8fafc', fg: '#475569', bd: '#e2e8f0' };
  }

  function refreshSyncBadgeDom() {
    var doc = window.document;
    if (!doc) return;
    var badge = doc.getElementById('ltrSyncStatusBadge');
    if (!badge) return;
    var b = syncBadgeTextAndTone();
    badge.textContent = b.text;
    badge.style.background = b.bg;
    badge.style.color = b.fg;
    badge.style.borderColor = b.bd;
  }

  function refreshHistoryDom() {
    var doc = window.document;
    if (!doc) return;
    refreshSyncBadgeDom();
    var allActiveCount = state.records.filter(isRecordActive).length;
    var empActiveCount = getEmployeeHistory(state.form.empCode, state.form.empName).length;
    var allBtn = doc.getElementById('ltrScopeAllBtn');
    if (allBtn) {
      allBtn.textContent = 'All Records (' + allActiveCount + ')';
      allBtn.className = 'ltr-tab-btn' + (state.historyScope === 'all' ? ' active' : '');
    }
    var empBtn = doc.getElementById('ltrScopeEmpBtn');
    if (empBtn) {
      empBtn.textContent = 'This Emp (' + empActiveCount + ')';
      empBtn.className = 'ltr-tab-btn' + (state.historyScope === 'employee' ? ' active' : '');
    }
    var histBody = doc.getElementById('ltrHistoryBodyWrap');
    if (!histBody) return;
    var searchEl = doc.getElementById('ltrHistorySearchInput');
    if (searchEl && doc.activeElement === searchEl) {
      var tbody = histBody.querySelector('tbody');
      if (tbody) {
        var filtered = getFilteredHistory();
        tbody.innerHTML = filtered.length ? filtered.map(renderHistoryRowHtml).join('') : '<tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b">No matching records.</td></tr>';
      }
      return;
    }
    histBody.innerHTML = renderHistoryInnerHtml();
  }

  function refreshPreviewAndCalculatedDom() {
    var doc = window.document;
    if (!doc) return;
    var f = state.form;
    var daysEl = doc.getElementById('ltrDaysValue');
    if (daysEl) daysEl.textContent = String(f.days || 0);
    var daysLbl = doc.getElementById('ltrDaysWord');
    if (daysLbl) daysLbl.textContent = Number(f.days) === 1 ? 'Day' : 'Days';

    var retEl = doc.getElementById('ltrReturnDate');
    if (retEl && retEl.value !== f.returnDate) retEl.value = f.returnDate || '';
    var retHint = doc.getElementById('ltrReturnHint');
    if (retHint) retHint.textContent = state.returnDateManual ? 'Manual date active' : 'Auto (+1 day after leave)';

    var syncField = function (id, val) {
      var el = doc.getElementById(id);
      if (el && el.value !== (val || '') && doc.activeElement !== el) el.value = val || '';
    };
    syncField('ltrEmpName', f.empName);
    syncField('ltrDesignation', f.designation);
    syncField('ltrDepartment', f.department);
    syncField('ltrFatherName', f.fatherName);
    syncField('ltrAadhaarNo', f.aadhaarNo);
    syncField('ltrPanNo', f.panNo);
    syncField('ltrPermanentAddress', f.permanentAddress);
    syncField('ltrAuthSignatory', f.authSignatory);
    syncField('ltrSignatoryName', f.signatoryName);
    syncField('ltrSignatoryDesig', f.signatoryDesignation);

    var preview = doc.getElementById('ltrLivePreviewSheet');
    if (preview) preview.innerHTML = buildLetterInnerHtml(f);

    refreshHistoryDom();
  }

  function renderSuggestionsHtml(query) {
    var hits = searchEmployees(query);
    if (!hits.length) return '';
    return hits.map(function (e) {
      return (
        '<div class="ltr-suggest-item" data-emp-code="' + esc(e.empCode) + '">' +
          '<div><strong>' + esc(e.empCode) + '</strong> · ' + esc(e.empName || '—') + '</div>' +
          '<div style="color:#64748b;font-size:11px">' + esc([e.designation, e.department].filter(Boolean).join(' · ')) + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderHistoryRowHtml(r) {
    var isBank = r.letterType === 'BANK';
    var period = isBank
      ? ('SBI Bank Letter (' + formatDateDDMMYYYY(r.letterDate) + ')')
      : (formatDateDDMMYY(r.fromDate) + ' → ' + formatDateDDMMYY(r.toDate));
    var subPeriod = isBank
      ? (r.aadhaarNo ? ('Aadhaar: ' + r.aadhaarNo) : 'Account Opening')
      : ('Return: ' + formatDateDDMMYYYY(r.returnDate));
    var daysCol = isBank ? 'Bank' : (esc(r.days) + ' d');
    var signCol = isBank ? (r.signatoryName || r.authSignatory || '—') : (r.signedBy || '—');

    return (
      '<tr>' +
        '<td><div style="font-weight:700">' + esc(r.empCode || '—') + ' · ' + esc(r.empName) + '</div><div style="font-size:11px;color:#64748b">' + esc([r.designation, r.department].filter(Boolean).join(' · ')) + '</div></td>' +
        '<td><div>' + esc(period) + '</div><div style="font-size:11px;color:#64748b">' + esc(subPeriod) + '</div></td>' +
        '<td style="font-weight:800;color:#4f46e5">' + daysCol + '</td>' +
        '<td><div>' + esc(signCol) + '</div><div style="font-size:11px;color:#64748b">' + esc(r.reason || '') + '</div></td>' +
        '<td style="white-space:nowrap">' +
          '<button type="button" class="ltr-btn ltr-btn-xs" data-ltr-action="load" data-ltr-id="' + esc(r.id) + '">Open</button> ' +
          '<button type="button" class="ltr-btn ltr-btn-xs" data-ltr-action="download" data-ltr-id="' + esc(r.id) + '">.doc</button> ' +
          '<button type="button" class="ltr-btn ltr-btn-xs" style="color:#b91c1c;border-color:#fecaca" data-ltr-action="delete" data-ltr-id="' + esc(r.id) + '">Del</button>' +
        '</td>' +
      '</tr>'
    );
  }

  function renderHistoryInnerHtml() {
    var f = state.form;
    var hasEmp = Boolean(String(f.empCode || '').trim() || String(f.empName || '').trim());
    var empHistory = hasEmp ? getEmployeeHistory(f.empCode, f.empName) : [];
    var rows = getFilteredHistory();
    var totalDays = empHistory.reduce(function (s, r) { return s + (Number(r.days) || 0); }, 0);
    var lastLeave = empHistory.length ? formatDateDDMMYYYY(empHistory[0].toDate || empHistory[0].fromDate || empHistory[0].letterDate) : '—';

    var kpisHtml = '';
    if (state.historyScope === 'employee' && hasEmp) {
      kpisHtml = (
        '<div class="ltr-kpis">' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + empHistory.length + '</div><div class="ltr-kpi-l">Letters (' + esc(f.empCode || f.empName) + ')</div></div>' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + totalDays + ' Days</div><div class="ltr-kpi-l">Total Leave Days</div></div>' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + esc(lastLeave) + '</div><div class="ltr-kpi-l">Last Letter Date</div></div>' +
        '</div>'
      );
    } else {
      var allActive = state.records.filter(isRecordActive);
      var bankCount = allActive.filter(function (r) { return (r.letterType || 'LEAVE') === 'BANK'; }).length;
      var leaveCount = allActive.length - bankCount;
      kpisHtml = (
        '<div class="ltr-kpis">' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + allActive.length + '</div><div class="ltr-kpi-l">Total Saved Letters</div></div>' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + leaveCount + ' / ' + bankCount + '</div><div class="ltr-kpi-l">Leave / Bank Letters</div></div>' +
          '<div class="ltr-kpi"><div class="ltr-kpi-v">' + rows.length + '</div><div class="ltr-kpi-l">Showing Records</div></div>' +
        '</div>'
      );
    }

    var tableRows = rows.length ? rows.map(renderHistoryRowHtml).join('') : (
      '<tr><td colspan="5" style="text-align:center;padding:24px;color:#64748b">' +
        (state.historyScope === 'employee' && hasEmp
          ? 'Is employee (' + esc(f.empCode || f.empName) + ') ki abhi koi saved letter history nahi hai. Save ya Download karte hi record yahan aa jayega.'
          : 'Koi letter record nahi mila. Save History ya Download dabate hi record yahan save & sync ho jayega.') +
      '</td></tr>'
    );

    return (
      kpisHtml +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">' +
        '<input id="ltrHistorySearchInput" class="ltr-input" style="flex:1;min-width:180px" type="search" placeholder="History search by Code, Name, Dept, Reason, Signatory..." value="' + esc(state.historySearch) + '">' +
        '<select id="ltrHistoryTypeSelect" class="ltr-select" style="width:130px">' +
          '<option value="ALL"' + (state.historyTypeFilter === 'ALL' ? ' selected' : '') + '>All Formats</option>' +
          '<option value="LEAVE"' + (state.historyTypeFilter === 'LEAVE' ? ' selected' : '') + '>Leave Only</option>' +
          '<option value="BANK"' + (state.historyTypeFilter === 'BANK' ? ' selected' : '') + '>Bank Only</option>' +
        '</select>' +
      '</div>' +
      '<div class="ltr-table-wrap">' +
        '<table class="ltr-table">' +
          '<thead><tr><th>Employee</th><th>Letter / Dates</th><th>Days / Type</th><th>Signed / Info</th><th>Actions</th></tr></thead>' +
          '<tbody>' + tableRows + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  function renderUI() {
    var doc = window.document;
    if (!doc) return;
    var container = doc.getElementById('letterModuleContainer');
    if (!container) return;
    ensureStyles();

    var f = state.form;
    var isBank = f.letterType === 'BANK';
    var empListCount = getEmployeeMasterList().length;
    var allActiveCount = state.records.filter(isRecordActive).length;
    var empActiveCount = getEmployeeHistory(f.empCode, f.empName).length;
    var badge = syncBadgeTextAndTone();

    var dynamicFieldsHtml = isBank
      ? (
        '<div class="ltr-field-full ltr-check-row">' +
          '<label><input id="ltrAutoHindi" type="checkbox"' + (f.autoHindi !== false ? ' checked' : '') + '> Auto English → Hindi</label>' +
          '<label><input id="ltrLetterheadSpace" type="checkbox"' + (f.letterheadSpace !== false ? ' checked' : '') + '> Letterhead Top Space (5 Lines)</label>' +
          '<label><input id="ltrHideBankHeader" type="checkbox"' + (f.hideBankHeader ? ' checked' : '') + '> Hide Company Title</label>' +
          '<button type="button" id="ltrBtnConvertHindi" class="ltr-btn ltr-btn-xs" style="margin-left:auto">अ Convert All</button>' +
        '</div>' +

        '<div class="ltr-field-full">' +
          '<label class="ltr-lbl" for="ltrEmpName">1. कर्मचारी का नाम (Name - English me likhne par Hindi banega)</label>' +
          '<input id="ltrEmpName" type="text" class="ltr-input" data-hindi-field="empName" placeholder="e.g. Sampat Lal" value="' + esc(f.empName) + '">' +
        '</div>' +

        '<div class="ltr-field-full">' +
          '<label class="ltr-lbl" for="ltrFatherName">2. पिता का नाम (Father\'s Name)</label>' +
          '<input id="ltrFatherName" type="text" class="ltr-input" data-hindi-field="fatherName" placeholder="e.g. Mohan Lal" value="' + esc(f.fatherName) + '">' +
        '</div>' +

        '<div>' +
          '<label class="ltr-lbl" for="ltrAadhaarNo">3. आधार कार्ड नंबर (Aadhaar No)</label>' +
          '<input id="ltrAadhaarNo" type="text" class="ltr-input" placeholder="e.g. 1234 5678 9012" value="' + esc(f.aadhaarNo) + '">' +
        '</div>' +
        '<div>' +
          '<label class="ltr-lbl" for="ltrPanNo">4. पैन कार्ड नंबर (PAN No)</label>' +
          '<input id="ltrPanNo" type="text" class="ltr-input" placeholder="e.g. ABCDE1234F" value="' + esc(f.panNo) + '">' +
        '</div>' +

        '<div class="ltr-field-full">' +
          '<label class="ltr-lbl" for="ltrPermanentAddress">5. स्थायी पता (Permanent Address - 2 Lines)</label>' +
          '<textarea id="ltrPermanentAddress" class="ltr-textarea" data-hindi-field="permanentAddress" rows="2" placeholder="e.g. Gram Khara, Tehsil Bikaner&#10;Dist Bikaner, Rajasthan">' + esc(f.permanentAddress) + '</textarea>' +
        '</div>' +

        '<div class="ltr-field-full">' +
          '<label class="ltr-lbl" for="ltrAuthSignatory">अधिकृत हस्ताक्षरकर्ता (Authorized Signatory - optional)</label>' +
          '<input id="ltrAuthSignatory" type="text" class="ltr-input" data-hindi-field="authSignatory" placeholder="e.g. Sarthak Arora" value="' + esc(f.authSignatory) + '">' +
        '</div>' +

        '<div>' +
          '<label class="ltr-lbl" for="ltrSignatoryName">हस्ताक्षरकर्ता का नाम</label>' +
          '<input id="ltrSignatoryName" type="text" class="ltr-input" data-hindi-field="signatoryName" placeholder="e.g. Manish Ji" value="' + esc(f.signatoryName) + '">' +
        '</div>' +
        '<div>' +
          '<label class="ltr-lbl" for="ltrSignatoryDesig">पद (Designation)</label>' +
          '<input id="ltrSignatoryDesig" type="text" class="ltr-input" data-hindi-field="signatoryDesignation" placeholder="e.g. Director" value="' + esc(f.signatoryDesignation) + '">' +
        '</div>'
      )
      : (
        '<div class="ltr-field-full">' +
          '<label class="ltr-lbl" for="ltrEmpName">Employee Name</label>' +
          '<input id="ltrEmpName" type="text" class="ltr-input" placeholder="Employee Name" value="' + esc(f.empName) + '">' +
        '</div>' +

        '<div>' +
          '<label class="ltr-lbl" for="ltrDesignation">Designation</label>' +
          '<input id="ltrDesignation" type="text" class="ltr-input" placeholder="e.g. BLEND MASTER" value="' + esc(f.designation) + '">' +
        '</div>' +
        '<div>' +
          '<label class="ltr-lbl" for="ltrDepartment">Department</label>' +
          '<input id="ltrDepartment" type="text" class="ltr-input" placeholder="e.g. Quality" value="' + esc(f.department) + '">' +
        '</div>' +

        '<div>' +
          '<label class="ltr-lbl" for="ltrFromDate">Leave From Date</label>' +
          '<input id="ltrFromDate" type="date" class="ltr-input" value="' + esc(f.fromDate) + '">' +
        '</div>' +
        '<div>' +
          '<label class="ltr-lbl" for="ltrToDate">Leave To Date</label>' +
          '<input id="ltrToDate" type="date" class="ltr-input" value="' + esc(f.toDate) + '">' +
        '</div>' +

        '<div>' +
          '<label class="ltr-lbl">Total Leave Days (Auto)</label>' +
          '<div class="ltr-days-box">' +
            '<span style="font-size:12px;color:#475569;font-weight:600">Inclusive Count</span>' +
            '<span><span id="ltrDaysValue" class="ltr-days-num">' + esc(f.days) + '</span> <span id="ltrDaysWord" style="font-size:12px;font-weight:700;color:#4f46e5">' + (Number(f.days) === 1 ? 'Day' : 'Days') + '</span></span>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<label class="ltr-lbl" for="ltrReturnDate">Next Available Date <button type="button" id="ltrBtnResetReturn" class="ltr-btn ltr-btn-xs" style="margin-left:6px;padding:1px 6px;font-size:10px">Auto</button></label>' +
          '<input id="ltrReturnDate" type="date" class="ltr-input" value="' + esc(f.returnDate) + '">' +
          '<div id="ltrReturnHint" style="font-size:10px;color:#64748b;margin-top:3px">' + (state.returnDateManual ? 'Manual date active' : 'Auto (+1 day after leave)') + '</div>' +
        '</div>' +

        '<div class="ltr-field-full">' +
          '<label class="ltr-lbl" for="ltrSignedBy">Signed By (Authorized Signatory)</label>' +
          '<select id="ltrSignedBy" class="ltr-select">' +
            SIGNED_BY_OPTIONS.map(function (opt) {
              return '<option value="' + esc(opt) + '"' + (f.signedBy === opt ? ' selected' : '') + '>' + esc(opt) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +

        '<div class="ltr-field-full">' +
          '<label class="ltr-lbl" for="ltrReason">Leave Reason (because of ...)</label>' +
          '<textarea id="ltrReason" class="ltr-textarea" rows="2" placeholder="some personal reason">' + esc(f.reason) + '</textarea>' +
        '</div>'
      );

    container.innerHTML = (
      '<div class="ltr-shell">' +
        '<div class="ltr-topbar">' +
          '<div>' +
            '<h1 class="ltr-title">HR Letters &amp; Leave Application</h1>' +
            '<div class="ltr-sub">Employee Master se auto-fill, Leave Application &amp; SBI Bank Account Letter (Hindi + Letterhead Space), Word (.doc) / PDF Print &amp; Cloud-Synced History.</div>' +
          '</div>' +
          '<div class="ltr-actions">' +
            '<button type="button" id="ltrBtnNew" class="ltr-btn">+ New Letter</button>' +
            '<button type="button" id="ltrBtnSave" class="ltr-btn">Save History</button>' +
            '<button type="button" id="ltrBtnPrint" class="ltr-btn ltr-btn-dark">Print / Save PDF</button>' +
            '<button type="button" id="ltrBtnDownloadDoc" class="ltr-btn ltr-btn-primary">Download Word (.doc)</button>' +
          '</div>' +
        '</div>' +

        (state.statusMessage ? '<div class="ltr-status ' + esc(state.statusTone) + '">' + esc(state.statusMessage) + '</div>' : '') +

        '<div class="ltr-grid">' +
          '<div class="ltr-col">' +
            '<div class="ltr-panel">' +
              '<div class="ltr-panel-head">' +
                '<div class="ltr-panel-title">' + (isBank ? 'Bank Account Letter Details (Hindi)' : 'Leave Letter Details') + '</div>' +
                '<div style="font-size:11px;color:#64748b">Master Loaded: <strong>' + empListCount + '</strong></div>' +
              '</div>' +
              '<div class="ltr-panel-body">' +
                '<div class="ltr-form-grid">' +
                  '<div>' +
                    '<label class="ltr-lbl" for="ltrTemplateType">Letter Format</label>' +
                    '<select id="ltrTemplateType" class="ltr-select">' +
                      LETTER_TYPES.map(function (t) {
                        return '<option value="' + esc(t.id) + '"' + (f.letterType === t.id ? ' selected' : '') + '>' + esc(t.label) + '</option>';
                      }).join('') +
                    '</select>' +
                  '</div>' +
                  '<div>' +
                    '<label class="ltr-lbl" for="ltrLetterDate">' + (isBank ? 'पत्र लिखने की दिनांक' : 'Letter Date') + '</label>' +
                    '<input id="ltrLetterDate" type="date" class="ltr-input" value="' + esc(f.letterDate) + '">' +
                  '</div>' +

                  '<div class="ltr-field-full ltr-emp-wrap">' +
                    '<label class="ltr-lbl" for="ltrEmpCode">Employee Code (Auto-Lookup)</label>' +
                    '<input id="ltrEmpCode" type="text" class="ltr-input" autocomplete="off" placeholder="Emp Code daaliye (e.g. 25447) ya Naam type karein..." value="' + esc(f.empCode) + '">' +
                    '<div id="ltrEmpSuggest" class="ltr-suggest"></div>' +
                  '</div>' +

                  dynamicFieldsHtml +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div class="ltr-panel">' +
              '<div class="ltr-panel-head" style="flex-wrap:wrap">' +
                '<div style="display:flex;align-items:center;gap:8px">' +
                  '<div class="ltr-panel-title">Employee Letter History</div>' +
                  '<span id="ltrSyncStatusBadge" style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid ' + badge.bd + ';background:' + badge.bg + ';color:' + badge.fg + '">' + esc(badge.text) + '</span>' +
                '</div>' +
                '<div class="ltr-hist-tabs">' +
                  '<button type="button" id="ltrScopeAllBtn" class="ltr-tab-btn' + (state.historyScope === 'all' ? ' active' : '') + '">All Records (' + allActiveCount + ')</button>' +
                  '<button type="button" id="ltrScopeEmpBtn" class="ltr-tab-btn' + (state.historyScope === 'employee' ? ' active' : '') + '">This Emp (' + empActiveCount + ')</button>' +
                  '<button type="button" id="ltrBtnSyncNow" class="ltr-tab-btn" title="Cloud se letters sync karein">Sync</button>' +
                '</div>' +
              '</div>' +
              '<div class="ltr-panel-body" id="ltrHistoryBodyWrap">' +
                renderHistoryInnerHtml() +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="ltr-panel">' +
            '<div class="ltr-panel-head">' +
              '<div class="ltr-panel-title">Live A4 Letter Format Preview (Exact Print &amp; Download Layout)</div>' +
              '<div style="font-size:11px;color:#64748b">' + (isBank ? 'Hindi Letterhead · A4 Portrait' : 'Times New Roman · A4 Portrait') + '</div>' +
            '</div>' +
            '<div class="ltr-paper-wrap">' +
              '<div class="ltr-paper" id="ltrLivePreviewSheet">' +
                buildLetterInnerHtml(f) +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    bindDomEvents(container);
  }

  function bindDomEvents(container) {
    var doc = window.document;
    if (!doc) return;

    function on(id, ev, fn) {
      var el = doc.getElementById(id);
      if (el) el.addEventListener(ev, fn);
      return el;
    }

    on('ltrBtnNew', 'click', startNewLetter);
    on('ltrBtnSave', 'click', function () { saveCurrentLetter(); });
    on('ltrBtnDownloadDoc', 'click', function () { downloadRecordDoc(); });
    on('ltrBtnPrint', 'click', function () { printRecordLetter(); });
    on('ltrBtnResetReturn', 'click', resetReturnDateAuto);
    on('ltrBtnSyncNow', 'click', function () {
      setStatus('Syncing letter history from cloud...', 'info');
      refreshSyncBadgeDom();
      syncNow(true).then(function (r) {
        if (r && r.synced) {
          setStatus('Letter history synced (' + state.records.filter(isRecordActive).length + ' records).', 'success');
        } else {
          setStatus('Offline / Local letter history active (' + state.records.filter(isRecordActive).length + ' records).', 'info');
        }
        renderUI();
      });
    });
    on('ltrBtnConvertHindi', 'click', function () {
      convertBankFieldsToHindiNow();
      setStatus('English fields Hindi mein convert ho gaye.', 'success');
      renderUI();
    });

    on('ltrScopeEmpBtn', 'click', function () {
      state.historyScope = 'employee';
      renderUI();
    });
    on('ltrScopeAllBtn', 'click', function () {
      state.historyScope = 'all';
      renderUI();
    });

    on('ltrTemplateType', 'change', function (e) { setFormField('letterType', e.target.value); });
    on('ltrLetterDate', 'change', function (e) { setFormField('letterDate', e.target.value); });
    on('ltrEmpName', 'input', function (e) { setFormField('empName', e.target.value); });
    on('ltrDesignation', 'input', function (e) { setFormField('designation', e.target.value); });
    on('ltrDepartment', 'input', function (e) { setFormField('department', e.target.value); });
    on('ltrFromDate', 'change', function (e) { setFormField('fromDate', e.target.value); });
    on('ltrToDate', 'change', function (e) { setFormField('toDate', e.target.value); });
    on('ltrReturnDate', 'change', function (e) { setFormField('returnDate', e.target.value); });
    on('ltrSignedBy', 'change', function (e) { setFormField('signedBy', e.target.value); });
    on('ltrReason', 'input', function (e) { setFormField('reason', e.target.value); });

    // Bank letter fields
    on('ltrFatherName', 'input', function (e) { setFormField('fatherName', e.target.value); });
    on('ltrAadhaarNo', 'input', function (e) { setFormField('aadhaarNo', e.target.value); });
    on('ltrPanNo', 'input', function (e) { setFormField('panNo', e.target.value); });
    on('ltrPermanentAddress', 'input', function (e) { setFormField('permanentAddress', e.target.value); });
    on('ltrAuthSignatory', 'input', function (e) { setFormField('authSignatory', e.target.value); });
    on('ltrSignatoryName', 'input', function (e) { setFormField('signatoryName', e.target.value); });
    on('ltrSignatoryDesig', 'input', function (e) { setFormField('signatoryDesignation', e.target.value); });
    on('ltrAutoHindi', 'change', function (e) { setFormField('autoHindi', e.target.checked); });
    on('ltrLetterheadSpace', 'change', function (e) { setFormField('letterheadSpace', e.target.checked); });
    on('ltrHideBankHeader', 'change', function (e) { setFormField('hideBankHeader', e.target.checked); });

    if (state.form.letterType === 'BANK') {
      var hindiInputs = container.querySelectorAll('[data-hindi-field]');
      hindiInputs.forEach(function (inp) {
        var fieldKey = inp.getAttribute('data-hindi-field');
        inp.addEventListener('blur', function () {
          if (!state.form.autoHindi) return;
          var converted = convertEnglishToHindi(inp.value);
          if (converted !== inp.value) {
            inp.value = converted;
            setFormField(fieldKey, converted);
          }
        });
        inp.addEventListener('keyup', function (ev) {
          if (!state.form.autoHindi) return;
          if (ev && (ev.key === ' ' || ev.key === 'Enter')) {
            var pos = inp.selectionStart;
            var before = inp.value;
            var converted = convertEnglishToHindi(before);
            if (converted !== before) {
              var delta = converted.length - before.length;
              inp.value = converted;
              setFormField(fieldKey, converted);
              if (typeof pos === 'number' && typeof inp.setSelectionRange === 'function') {
                var nextPos = Math.max(0, pos + delta);
                try { inp.setSelectionRange(nextPos, nextPos); } catch (_) {}
              }
            }
          }
        });
      });
    }

    var codeInput = doc.getElementById('ltrEmpCode');
    var suggestBox = doc.getElementById('ltrEmpSuggest');
    if (codeInput) {
      codeInput.addEventListener('input', function (e) {
        var val = e.target.value;
        setFormField('empCode', val);
        if (suggestBox) {
          var sHtml = val.trim() ? renderSuggestionsHtml(val) : '';
          suggestBox.innerHTML = sHtml;
          suggestBox.classList.toggle('open', Boolean(sHtml));
        }
      });
      codeInput.addEventListener('focus', function (e) {
        if (suggestBox) {
          var sHtml = renderSuggestionsHtml(e.target.value);
          suggestBox.innerHTML = sHtml;
          suggestBox.classList.toggle('open', Boolean(sHtml));
        }
      });
      codeInput.addEventListener('blur', function () {
        setTimeout(function () {
          if (suggestBox) suggestBox.classList.remove('open');
        }, 180);
      });
    }

    if (suggestBox) {
      suggestBox.addEventListener('mousedown', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('[data-emp-code]') : null;
        if (!item) return;
        e.preventDefault();
        var chosen = item.getAttribute('data-emp-code') || '';
        setFormField('empCode', chosen);
        if (codeInput) codeInput.value = state.form.empCode;
        suggestBox.classList.remove('open');
        refreshPreviewAndCalculatedDom();
      });
    }

    container.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'ltrHistorySearchInput') {
        state.historySearch = e.target.value || '';
        refreshHistoryDom();
      }
    });

    container.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'ltrHistoryTypeSelect') {
        state.historyTypeFilter = e.target.value || 'ALL';
        refreshHistoryDom();
      }
    });

    container.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-ltr-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-ltr-action');
      var id = btn.getAttribute('data-ltr-id');
      if (action === 'load') {
        loadRecordIntoForm(id);
      } else if (action === 'download') {
        var rec = state.records.find(function (r) { return r && r.id === id; });
        if (rec) downloadRecordDoc(rec);
      } else if (action === 'delete') {
        deleteRecord(id);
      }
    });
  }

  function setupListeners() {
    if (window.__ATPL_LETTERS_LISTENERS__) return;
    window.__ATPL_LETTERS_LISTENERS__ = true;

    try {
      window.addEventListener('storage', function (ev) {
        if (!ev) return;
        if (ev.key === STORAGE_KEY || ev.key === TOMBSTONE_KEY) {
          loadFromLocalStorage();
          refreshHistoryDom();
        } else if (ev.key === 'ATPL_TRIGGER_EVENT' && ev.newValue) {
          try {
            var trig = JSON.parse(ev.newValue);
            var act = trig && (trig.action || trig.type);
            if (trig && trig.sender !== MY_CLIENT_ID && (act === 'leave_letter_saved' || act === 'leave_letter_deleted' || act === 'leave_letters_synced')) {
              syncNow(true);
            }
          } catch (_) {}
        }
      });
    } catch (_) {}

    try {
      if (typeof window.BroadcastChannel === 'function') {
        var ch = new window.BroadcastChannel(CHANNEL_NAME);
        ch.onmessage = function (ev) {
          var d = ev && ev.data;
          if (!d || d.sender === MY_CLIENT_ID) return;
          var t = d.type || d.action;
          if (t === 'leave_letter_saved' || t === 'leave_letter_deleted' || t === 'leave_letters_synced') {
            loadFromLocalStorage();
            refreshHistoryDom();
            if (t === 'leave_letters_synced') syncNow(true);
          }
        };
      }
    } catch (_) {}

    try {
      window.addEventListener('focus', function () { syncNow(false); });
      window.addEventListener('online', function () { syncNow(true); });
      if (window.document && typeof window.document.addEventListener === 'function') {
        window.document.addEventListener('visibilitychange', function () {
          if (!window.document.hidden) syncNow(false);
        });
        window.document.addEventListener('atpl-cloud-token-ready', function () { syncNow(true); });
        window.document.addEventListener('atpl-authenticated', function () { syncNow(true); });
      }
    } catch (_) {}

    try {
      if (typeof window.EventSource === 'function' && window.location && /^https?:/.test(window.location.protocol)) {
        var host = String(window.location.hostname || '');
        if (host === 'localhost' || host === '127.0.0.1' || /\.run\.app$/i.test(host)) {
          var es = new window.EventSource('/api/sync/events');
          es.addEventListener('leave_letter_saved', function (ev) {
            try {
              var rec = JSON.parse(ev.data || '{}');
              if (rec && rec.id) {
                mergeAuthoritativeState([rec], {});
                refreshHistoryDom();
              }
            } catch (_) {}
          });
          es.addEventListener('leave_letter_deleted', function (ev) {
            try {
              var d = JSON.parse(ev.data || '{}');
              if (d && d.id) {
                var tMap = {};
                tMap[d.id] = d.deleted_at || new Date().toISOString();
                mergeAuthoritativeState([], tMap);
                refreshHistoryDom();
              }
            } catch (_) {}
          });
        }
      }
    } catch (_) {}
  }

  function boot() {
    loadFromLocalStorage();
    recalcFormDates({ forceAutoReturn: true });
    setupListeners();
    var afterRender = function () {
      renderUI();
      hydrateFromIndexedDb().then(function () {
        syncNow(true);
      });
    };
    if (window.document && window.document.readyState === 'loading') {
      window.document.addEventListener('DOMContentLoaded', afterRender, { once: true });
    } else {
      afterRender();
    }
  }

  window.ATPLLettersManager = {
    SIGNED_BY_OPTIONS: SIGNED_BY_OPTIONS.slice(),
    LETTER_TYPES: LETTER_TYPES.slice(),
    CLOUD_FILENAME: CLOUD_FILENAME,
    state: state,
    convertEnglishToHindi: convertEnglishToHindi,
    diffDaysInclusive: diffDaysInclusive,
    addDaysISO: addDaysISO,
    formatDateDDMMYYYY: formatDateDDMMYYYY,
    formatDateDDMMYY: formatDateDDMMYY,
    findEmployeeByCode: findEmployeeByCode,
    searchEmployees: searchEmployees,
    setFormField: setFormField,
    resetReturnDateAuto: resetReturnDateAuto,
    buildLetterInnerHtml: buildLetterInnerHtml,
    buildDownloadDocumentHtml: buildDownloadDocumentHtml,
    saveCurrentLetter: saveCurrentLetter,
    downloadRecordDoc: downloadRecordDoc,
    printRecordLetter: printRecordLetter,
    loadRecordIntoForm: loadRecordIntoForm,
    startNewLetter: startNewLetter,
    deleteRecord: deleteRecord,
    getEmployeeHistory: getEmployeeHistory,
    getFilteredHistory: getFilteredHistory,
    getPendingCount: getPendingCount,
    mergeAuthoritativeState: mergeAuthoritativeState,
    onDriveFilesMeta: onDriveFilesMeta,
    renderUI: renderUI,
    syncNow: syncNow
  };

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
