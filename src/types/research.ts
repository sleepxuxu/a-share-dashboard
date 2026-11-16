export type ResearchSkillId='tape'|'fundamentals'|'risk'
export interface ResearchSkill {id:ResearchSkillId;name:string;description:string;instructions:string;version:string;origin:string}
export interface SkillResearch {
  code:string;name:string;skill:{id:ResearchSkillId;name:string;version:string;origin:string}
  mode:'checks'|'ai';generatedAt:string;marketAsOf:string|null;reportDate:string|null
  checks:{label:string;level:'info'|'caution'|'missing';detail:string}[]
  gaps:string[];sources:{name:string;url:string}[]
  content?:string;provider?:string;model?:string
}
