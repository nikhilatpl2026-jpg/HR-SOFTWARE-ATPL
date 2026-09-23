/* Redirect lazy loader to v10 commander */
window.toggleAIChat = function() { if (window.AroraAICommander) window.AroraAICommander.toggle(); };
window.sendAIMsg = function() {
  var inp = document.getElementById("aiInput") || document.getElementById("atplAiInput");
  var q = inp ? inp.value : "";
  if (inp) inp.value = "";
  if (window.AroraAICommander) window.AroraAICommander.open(q);
};
window.aiQuick = function(q) { if (window.AroraAICommander) window.AroraAICommander.open(q); };
