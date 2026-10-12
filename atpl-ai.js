window.toggleAIChat = function() {
  var box = document.getElementById("aiChatBox");
  if (!box) return;
  if (box.style.display === "none" || box.style.display === "") {
    box.style.display = "flex";
    setTimeout(function() {
      var inp = document.getElementById("aiInput");
      if (inp) inp.focus();
    }, 100);
  } else {
    box.style.display = "none";
  }
};

function answerClientSide(q) {
  var files = Array.isArray(window.FILES) ? window.FILES : [];
  var em = (window.EM && Array.isArray(window.EM.data)) ? window.EM.data : (Array.isArray(window.EMP_MASTER_DATA) ? window.EMP_MASTER_DATA : []);
  var lower = (q || '').toLowerCase().trim();

  // If query is for Arora Commander specialized action
  if (window.AroraAICommander && typeof window.AroraAICommander.processQuery === 'function') {
    try {
      var cmdRes = window.AroraAICommander.processQuery(q);
      if (cmdRes && cmdRes.html && !cmdRes.html.includes('Abhi tak yeh file upload nahi hui')) {
        return cmdRes.html;
      }
    } catch (_) {}
  }

  // Answer file list questions
  if (lower.includes('file') || lower.includes('kitni file') || lower.includes('list')) {
    if (!files.length) return "📂 Abhi koi salary/Excel file upload nahi hui hai.";
    var list = files.map(function(f, i) {
      return (i + 1) + ". <strong>" + (f.name || 'Unnamed') + "</strong> (" + (f.sheets ? Object.keys(f.sheets).length : 1) + " sheets)";
    }).join("<br>");
    return "📁 <strong>Total " + files.length + " files loaded hain:</strong><br><br>" + list;
  }

  // Answer employee master questions
  if (lower.includes('employee') || lower.includes('karamchari') || lower.includes('staff') || lower.includes('emp')) {
    var match = lower.match(/\b\d{4,6}\b/);
    if (match) {
      var code = match[0];
      var emp = em.find(function(e) { return String(e.emp_id || e.code || e.empCode || '').trim() === code; });
      if (emp) {
        return "👤 <strong>Employee " + code + " Details:</strong><br>" +
          "• Naam: <strong>" + (emp.name || '—') + "</strong><br>" +
          "• Father: " + (emp.father || '—') + "<br>" +
          "• Department: " + (emp.dept || '—') + "<br>" +
          "• Designation: " + (emp.desig || '—') + "<br>" +
          "• Gross: ₹" + (emp.gross || '0') + " | Basic: ₹" + (emp.basic || '0') + "<br>" +
          "• PF No: " + (emp.pf_no || '—') + " | ESI No: " + (emp.esi_no || '—') + "<br>" +
          "• Status: " + (emp.status || 'ACTIVE');
      }
      return "⚠️ Employee Code <strong>" + code + "</strong> Employee Master mein nahi mila.";
    }
    return "👥 <strong>Employee Master Summary:</strong><br>Total " + em.length + " employees registered hain. Kisi specific employee ke baare mein janne ke liye uska code likhein (e.g. <em>22157 details</em>).";
  }

  // Answer PF / ESIC questions
  if (lower.includes('pf') || lower.includes('esi') || lower.includes('challan')) {
    return "🏛️ <strong>PF & ESIC Status:</strong><br>" +
      "• Total Files: " + files.length + "<br>" +
      "• Master Employees: " + em.length + "<br>" +
      "Aap <strong>PF & ESIC Challan</strong> tab mein jaakar official EPFO ECR aur ESIC Return generate aur export kar sakte hain.";
  }

  // General summary
  return "🤖 <strong>Arora HR AI Intelligence:</strong><br>" +
    "• Total Uploaded Files: <strong>" + files.length + "</strong><br>" +
    "• Employee Master Count: <strong>" + em.length + "</strong> staff<br>" +
    "Aap mujhse kisi bhi file ka data, employee ka PF/ESI details, salary sheet ka summary ya compliance status pooch sakte hain!";
}

window.sendAIMsg = async function() {
  var inp = document.getElementById("aiInput");
  var text = (inp ? inp.value : "").trim();
  if (!text) return;
  if (inp) inp.value = "";
  var msgs = document.getElementById("aiMessages");
  if (!msgs) return;

  msgs.innerHTML += "<div class='ai-msg ai-user' style='text-align:right; margin:6px 0;'><div class='ai-bubble' style='background:#E0E7FF;color:#3730A3;display:inline-block;padding:9px 13px;border-radius:14px;text-align:left;max-width:85%;font-size:12px;font-weight:600'>" + text + "</div></div>";
  var loadingId = "loading_" + Date.now();
  msgs.innerHTML += "<div class='ai-msg ai-bot' id='" + loadingId + "' style='margin:6px 0;'><div class='ai-bubble' style='background:#fff;border:1px solid #e2e8f0;display:inline-block;padding:9px 13px;border-radius:14px;font-size:12px;color:#64748b'>Soch raha hoon...</div></div>";
  msgs.scrollTop = msgs.scrollHeight;

  var answered = false;
  try {
    var res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });
    if (res.ok) {
      var json = await res.json();
      var l = document.getElementById(loadingId);
      if (l) l.remove();
      if (json && json.success && json.text) {
        msgs.innerHTML += "<div class='ai-msg ai-bot' style='margin:6px 0;'><div class='ai-bubble' style='background:#fff;border:1px solid #e2e8f0;display:inline-block;padding:10px 14px;border-radius:14px;font-size:12px;color:#1e293b;line-height:1.5'>" + json.text.replace(/\n/g, "<br>") + "</div></div>";
        answered = true;
      }
    }
  } catch (_) {}

  // Fallback to client-side files reader if /api/chat is unavailable (e.g. GitHub Pages)
  if (!answered) {
    var l = document.getElementById(loadingId);
    if (l) l.remove();
    var clientAnswer = answerClientSide(text);
    msgs.innerHTML += "<div class='ai-msg ai-bot' style='margin:6px 0;'><div class='ai-bubble' style='background:#fff;border:1px solid #e2e8f0;display:inline-block;padding:10px 14px;border-radius:14px;font-size:12px;color:#1e293b;line-height:1.5'>" + clientAnswer + "</div></div>";
  }

  msgs.scrollTop = msgs.scrollHeight;
};

window.aiQuick = function(q) {
  var inp = document.getElementById("aiInput");
  if (inp) {
    inp.value = q;
    window.sendAIMsg();
  }
};
