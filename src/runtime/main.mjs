const mode=process.env.VIDEOBOT_RUN_MODE||'bootstrap';
if(mode==='bootstrap'){
  await import('./gserverBootstrap.mjs');
}else if(mode==='telegram'){
  await import('./creatorEntrypoint.mjs');
}else{
  throw new Error('VIDEOBOT_RUN_MODE_UNSUPPORTED');
}
