export interface MarketSector {code:string;name:string;change:number;amount:number|null;rising:number|null;falling:number|null;leader:string|null}
export interface MarketCandidate {
  code:string;name:string;price:number;change:number;amount:number;amplitude:number|null;turnover:number;volumeRatio:number
  high:number;low:number;yesterday:number;netFlow:number|null;industry:string;asOf:string;sector:MarketSector|null
  score:number;reasons:string[];risks:string[]
}
export interface MarketSnapshot {
  asOf:string;fetchedAt:string;marketDate:string;isToday:boolean;stale:boolean;universeSize:number;scannedCount:number
  breadth:{rising:number;falling:number};weak:boolean;stance:string;warnings:string[]
  indices:{name:string;code:string;price:number|null;change:number|null;amount:number|null;asOf:string|null}[]
  sectors:MarketSector[];candidates:MarketCandidate[]
  methodology:{name:string;description:string;filters:string[];scoring:string}
  source:{name:string;url:string}
}
