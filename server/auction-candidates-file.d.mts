export interface CandidateStore {
  load(sourceDate: string): Promise<unknown>
  save(value: unknown): Promise<void>
}
export function createFileCandidateStore(file?:string):CandidateStore
