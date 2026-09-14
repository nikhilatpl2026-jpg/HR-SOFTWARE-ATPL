'use strict';
const master=[{
  emp_id:'00135',name:'EMPLOYEE ALPHA',father:'PARENT ALPHA',dob:'05-05-1995',doj:'01-01-2024',gender:'MALE',dept:'PACKING',desig:'OPERATOR',cat1:'CARD NO-12',basic:15000,hra:5000,gross:20000,uan:'SYNTH-UAN-A',pf_member_id:'SYNTH-PF-A',esi_no:'SYNTH-ESI-A',bank_name:'TEST BANK',ifsc:'SYNTH-IFSC-A',account_no:'SYNTH-ACCT-A',pf_status:'ACTIVE',esi_status:'ACTIVE'
},{
  emp_id:'00136',name:'EMPLOYEE BETA',father:'PARENT BETA',dob:'06-06-1996',doj:'02-01-2024',gender:'FEMALE',dept:'PACKING',desig:'HELPER',cat1:'CARD NO-12',basic:12000,hra:4000,gross:16000,uan:'SYNTH-UAN-B',pf_member_id:'SYNTH-PF-B',esi_no:'SYNTH-ESI-B',pf_status:'ACTIVE',esi_status:'ACTIVE'
}];
const monthly=[{
  empCode:'00135',empName:'EMPLOYEE ALPHA',paidDays:30,workingDays:26,otHours:0,otRate:null,otAmount:0,otApproval:'YES',advance:100,otherDeduction:50,deductionApproval:'YES',pfStatus:'ACTIVE',pfWage:15000,higherPf:'NO',higherPfEvidence:'',esiStatus:'ACTIVE',esiWage:20000,esiDailyWage:700,esiContinuation:'',uan:'SYNTH-UAN-A',pfMemberId:'SYNTH-PF-A',esiNo:'SYNTH-ESI-A',basic:15000,gross:20000,contractGross:20000,statutoryWage:15000,baseEarned:null,totalGross:20000,normalHourlyRate:null,department:'PACKING',designation:'OPERATOR',category:'CARD NO-12',remarks:'',exception:{type:'',reason:'',amount:null,approvedBy:'',approvalDate:'',evidence:'',resolution:''},fieldPresence:{advance:true,otherDeduction:true},source:{type:'MONTHLY',file:'Payroll_Sep_2026.xlsx',sheet:'Main Sheet',row:5}
},{
  empCode:'00136',empName:'EMPLOYEE BETA',paidDays:30,workingDays:26,otHours:0,otRate:null,otAmount:0,otApproval:'YES',advance:0,otherDeduction:0,deductionApproval:'YES',pfStatus:'ACTIVE',pfWage:12000,higherPf:'NO',higherPfEvidence:'',esiStatus:'ACTIVE',esiWage:16000,esiDailyWage:600,esiContinuation:'',uan:'SYNTH-UAN-B',pfMemberId:'SYNTH-PF-B',esiNo:'SYNTH-ESI-B',basic:12000,gross:16000,contractGross:16000,statutoryWage:12000,baseEarned:null,totalGross:16000,normalHourlyRate:null,department:'PACKING',designation:'HELPER',category:'CARD NO-12',remarks:'',exception:{type:'',reason:'',amount:null,approvedBy:'',approvalDate:'',evidence:'',resolution:''},fieldPresence:{advance:true,otherDeduction:true},source:{type:'MONTHLY',file:'Payroll_Sep_2026.xlsx',sheet:'Main Sheet',row:6}
}];
const mam=[
  {empCode:'00135',empName:'EMPLOYEE ALPHA',manualAmount:20000,source:{type:'MAM',file:'Mam_Sep_2026.xlsx',sheet:'Sheet1',row:2}},
  {empCode:'00136',empName:'EMPLOYEE BETA',manualAmount:16000,source:{type:'MAM',file:'Mam_Sep_2026.xlsx',sheet:'Sheet1',row:3}}
];
module.exports={master,monthly,mam};
