import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {createAuctionService} from '../server/auction.mjs'

const snapshot=await createAuctionService()()
assert.match(snapshot.tradeDate,/^\d{4}-\d{2}-\d{2}$/)
assert.ok(snapshot.previousTradeDate<snapshot.tradeDate)
assert.ok(snapshot.automatic.scannedCount===snapshot.records.length)
for(const stock of snapshot.records){
  assert.ok(stock.previousLimitUpVerified)
  if(stock.auctionAmount!==null){
    assert.ok(Number.isSafeInteger(stock.auctionVolume))
    assert.equal(stock.auctionAmount,Math.round(stock.price092500*100)*stock.auctionVolume/100)
  }
}
await mkdir('test-results',{recursive:true})
await writeFile('test-results/live-auction.json',JSON.stringify(snapshot,null,2))
console.log(JSON.stringify({tradeDate:snapshot.tradeDate,previousTradeDate:snapshot.previousTradeDate,...snapshot.automatic,
  completeRecords:snapshot.records.filter(stock=>!stock.dataWarnings.length).slice(0,3)},null,2))
