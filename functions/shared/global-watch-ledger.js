const nonNegativeInteger=(value,fallback=0)=>{
  const number=Number(value);
  return Number.isFinite(number)?Math.max(0,Math.trunc(number)):fallback;
};

const clampGlobalWatchValue=(value,availableThroughEp)=>Math.min(
  nonNegativeInteger(value),
  nonNegativeInteger(availableThroughEp),
);

const advanceGlobalWatchValue=(stored,requested,availableThroughEp)=>Math.max(
  nonNegativeInteger(stored),
  clampGlobalWatchValue(requested,availableThroughEp),
);

// Prediction timing is player-relative. The release frontier and join time do
// not prove what a player knows, so trusted private-pool play intentionally
// scores only from the player's monotonically confirmed watch position.
const resolveGlobalWatchWindow=trusted=>nonNegativeInteger(trusted?.watchedThrough);

const globalWatchLedgerReady=trusted=>
  Number.isInteger(trusted?.watchedThrough)&&trusted.watchedThrough>=0&&
  Number.isInteger(trusted?.joinedAtEp)&&trusted.joinedAtEp>=0;

const globalLedgerFieldsForJoin=trusted=>{
  const fields={};
  if(!Number.isInteger(trusted?.watchedThrough)||trusted.watchedThrough<0)fields.watchedThrough=0;
  if(!Number.isInteger(trusted?.joinedAtEp)||trusted.joinedAtEp<0)fields.joinedAtEp=0;
  return fields;
};

module.exports={
  advanceGlobalWatchValue,
  globalLedgerFieldsForJoin,
  globalWatchLedgerReady,
  resolveGlobalWatchWindow,
};
