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

const resolveGlobalWatchWindow=trusted=>Math.max(
  nonNegativeInteger(trusted?.watchedThrough),
  nonNegativeInteger(trusted?.joinedAtEp),
);

const globalWatchLedgerReady=trusted=>
  Number.isInteger(trusted?.watchedThrough)&&trusted.watchedThrough>=0&&
  Number.isInteger(trusted?.joinedAtEp)&&trusted.joinedAtEp>=0;

const globalLedgerFieldsForJoin=(trusted,releasedWhenJoined)=>{
  const fields={};
  if(!Number.isInteger(trusted?.watchedThrough)||trusted.watchedThrough<0)fields.watchedThrough=0;
  if(!Number.isInteger(trusted?.joinedAtEp)||trusted.joinedAtEp<0){
    fields.joinedAtEp=nonNegativeInteger(releasedWhenJoined);
  }
  return fields;
};

module.exports={
  advanceGlobalWatchValue,
  globalLedgerFieldsForJoin,
  globalWatchLedgerReady,
  resolveGlobalWatchWindow,
};
