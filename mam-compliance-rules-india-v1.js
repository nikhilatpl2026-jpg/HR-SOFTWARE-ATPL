/*
 * ATPL Mam Compliance — India statutory configuration v1
 * Configuration only. No employee data is embedded here.
 * Verified against official Government/EPFO/ESIC sources on 2026-09-14.
 */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.ATPLComplianceRulesIndiaV1=api;
})(typeof self!=='undefined'?self:this,function(){'use strict';
  return Object.freeze({
    id:'INDIA-HR-COMPLIANCE-2026.09-v1',
    version:'1.0.0',
    verifiedOn:'2026-09-14',
    jurisdiction:'India',
    sourcePolicy:'Official government / EPFO / ESIC sources only; historical payroll workbooks are never statutory rule sources.',
    sources:Object.freeze([
      {id:'EPFO_EMPLOYER_BOOKLET',authority:'EPFO',url:'https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/Employer_Information_Booklet.pdf',note:'EPF employee 12%; employer 12% split; wage ceiling and higher-wage joint request.'},
      {id:'ESIC_GLANCE',authority:'ESIC',url:'https://esic.gov.in/attachments/esistatedirectoratefile/ef84365f31f15306ddb397902d675858.pdf',note:'ESI coverage ceiling and employee/employer contribution rates.'},
      {id:'CODE_ON_WAGES_FAQ_2026',authority:'Ministry of Labour & Employment',url:'https://www.labour.gov.in/static/uploads/2026/01/75252c07c1fe3a2f5571ff1464e2375e.pdf',note:'50% deduction cap and wage-definition clarification.'},
      {id:'CODE_ON_WAGES_2019',authority:'Ministry of Labour & Employment',url:'https://labour.gov.in/sites/default/files/the_code_on_wages_2019_no._29_of_2019.pdf',note:'Wage definition and overtime not less than twice normal rate.'},
      {id:'LABOUR_CODES_FAQ_2026_03',authority:'Ministry of Labour & Employment',url:'https://www.labour.gov.in/static/uploads/2026/03/a4ccf4c6d97c4f1f36a6d83f8c64213d.pdf',note:'50% wage add-back clarification.'}
    ]),
    payroll:Object.freeze({
      diffBasis:'GROSS_EARNED',
      negativeDiffTreatment:'KEEP_SIGNED',
      noGuessing:true,
      crossMonthFallback:false,
      requiredMonthMatch:'EXACT'
    }),
    pf:Object.freeze({
      employeeRate:0.12,
      employerTotalRate:0.12,
      epsRate:0.0833,
      wageCeiling:15000,
      rounding:'NEAREST_RUPEE',
      membershipRequired:true,
      wageSourceRequired:true,
      higherWageRequiresEvidence:true,
      statuses:Object.freeze({active:['ACTIVE','YES','MEMBER','EXISTING','COVERED'],inactive:['NO','NON MEMBER','NON_MEMBER','EXCLUDED','NOT COVERED','NOT_COVERED']})
    }),
    esi:Object.freeze({
      employeeRate:0.0075,
      employerRate:0.0325,
      coverageCeiling:21000,
      pwdCoverageCeiling:25000,
      employeeShareDailyWageExemption:176,
      rounding:'NEAREST_RUPEE',
      wageSourceRequired:true,
      contributionPeriods:Object.freeze([{fromMonth:4,toMonth:9,label:'APR-SEP'},{fromMonth:10,toMonth:3,label:'OCT-MAR'}]),
      statuses:Object.freeze({active:['ACTIVE','YES','COVERED','MEMBER','CONTINUE','CONTINUING'],inactive:['NO','NOT COVERED','NOT_COVERED','EXCLUDED']})
    }),
    overtime:Object.freeze({
      minimumMultiplier:2,
      requireHoursSource:true,
      requireRateSource:true,
      requireApproval:true
    }),
    deductions:Object.freeze({
      maxRatio:0.50,
      requireApprovalForOtherDeductions:true
    }),
    wageDefinition:Object.freeze({
      keepSeparate:['contractGross','basic','statutoryWage','pfWage','esiWage'],
      excludedComponentThresholdRatio:0.50,
      addBackReviewRequired:true
    })
  });
});
