const mode=process.env.VIDEOBOT_RUN_MODE||'bootstrap';
if(mode==='bootstrap'){
  await import('./gserverBootstrap.mjs');
}else if(mode==='telegram_poll'){
  const {runCreatorPollingMain}=await import('./creatorPollingMain.mjs');
  await runCreatorPollingMain({onStatus:t=>process.stdout.write(t+'\n')});
}else if(mode==='telegram'){
  const {runCreatorEntrypoint}=await import('./creatorEntrypoint.mjs');
  await runCreatorEntrypoint();
}else{
  throw new Error('VIDEOBOT_RUN_MODE_UNSUPPORTED');
}
