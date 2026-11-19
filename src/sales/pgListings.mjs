/**
 * VideoBot-only listings database adapter. Never edits GATE, MPB or
 * TGtumbler profile tables. Persist Telegram file references, not bytes.
 *
 * Seller ownership is checked in SQL. Public paid content is immutable:
 * post-publication edits require a separate version/republication workflow
 * with purchased-user protection, not an UPDATE on the sold media.
 */
const LISTING_ID=/^[A-Za-z0-9_-]{1,40}$/;
function ownerId(owner) {
  if(!Number.isSafeInteger(owner)||owner<=0)throw new Error('invalid owner');
  return owner;
}
function listingId(id) {
  if(typeof id!=='string'||!LISTING_ID.test(id))throw new Error('invalid listing');
  return id;
}
function revisionNumber(n) {
  if(!Number.isSafeInteger(n)||n<0)throw new Error('invalid revision');
  return n;
}
function recordToListing(row) {
  if(!row)return null;
  return {
    id:row.listing_id,sellerId:String(row.seller_user_id),revision:Number(row.revision),
    title:row.title,description:row.description??'',priceStars:row.price_stars==null?null:Number(row.price_stars),
    priceMode:row.price_mode,
    thumbnail:row.thumbnail_file_id?{fileId:row.thumbnail_file_id}:null,
    sample:row.sample_file_id?{fileId:row.sample_file_id,
      durationSeconds:Number(row.sample_duration_seconds)}:null,
    paidVideo:row.paid_video_file_id?{fileId:row.paid_video_file_id}:null,
    rightsVerified:row.rights_verified===true,
    adultConsentVerified:row.adult_consent_verified===true,
    feeTermsAccepted:row.fee_terms_accepted_at!=null,
    termsVersion:row.creator_terms_version??null,
    termsUrl:row.creator_terms_url??null,
    termsAcceptedAt:row.fee_terms_accepted_at instanceof Date
      ?row.fee_terms_accepted_at.toISOString():row.fee_terms_accepted_at??null,
    managementFeeBps:row.management_fee_bps===undefined?null:Number(row.management_fee_bps),
    status:row.status
  };
}
function validatedDraft(draft) {
  if(!draft || typeof draft!=='object')throw new Error('listing draft missing');
  if(typeof draft.title!=='string'||draft.title.length>128)throw new Error('invalid title');
  if(typeof (draft.description??'')!=='string'||(draft.description??'').length>800)
    throw new Error('invalid video description');
  if(draft.priceStars!==null && draft.priceStars!==undefined &&
     (!Number.isSafeInteger(draft.priceStars)||draft.priceStars<1||draft.priceStars>25000))
    throw new Error('invalid Stars price');
  if(!['preset','custom'].includes(draft.priceMode))throw new Error('invalid price mode');
  for(const f of ['thumbnail','sample','paidVideo']){
    const v=draft[f];
    if(v!==null && v!==undefined &&
       (typeof v.fileId!=='string'||!/^[A-Za-z0-9_-]{3,256}$/.test(v.fileId)))
      throw new Error('invalid '+f+' reference');
  }
  if(draft.sample &&
     (!Number.isFinite(draft.sample.durationSeconds)||draft.sample.durationSeconds<=0||
      draft.sample.durationSeconds>30))throw new Error('sample longer than 30 seconds');
  if(draft.feeTermsAccepted===true &&
     (typeof draft.termsVersion!=='string'||!/^[0-9]+(?:\\.[0-9]+){0,2}$/.test(draft.termsVersion)||
      typeof draft.termsAcceptedAt!=='string'||!Number.isFinite(Date.parse(draft.termsAcceptedAt))||
      typeof draft.termsUrl!=='string'||!/^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9/_-]+\.html$/.test(draft.termsUrl)))
    throw new Error('versioned creator terms agreement required');
  return [
    draft.title,draft.priceStars??null,draft.priceMode,
    draft.thumbnail?.fileId??null,draft.sample?.fileId??null,
    draft.sample?.durationSeconds??null,draft.paidVideo?.fileId??null,
    draft.rightsVerified===true,draft.adultConsentVerified===true,
    draft.feeTermsAccepted===true,draft.description??'',
    draft.feeTermsAccepted===true?draft.termsVersion??null:null,
    draft.feeTermsAccepted===true?draft.termsUrl??null:null
  ];
}
export function createPostgresListingStore(pool) {
  if(typeof pool?.query!=='function')throw new Error('VideoBot private SQL pool required');
  return {
    async listByOwner(owner) {
      ownerId(owner);
      const result=await pool.query(
        "SELECT * FROM videobot_listings WHERE seller_user_id=$1 AND status<>'removed' ORDER BY updated_at DESC,listing_id DESC",
        [owner]
      );
      return (result.rows||[]).map(recordToListing);
    },
    async getOwned(owner,id) {
      ownerId(owner);listingId(id);
      const result=await pool.query(
        'SELECT * FROM videobot_listings WHERE seller_user_id=$1 AND listing_id=$2 AND status<>\'removed\'',
        [owner,id]
      );
      return recordToListing(result.rows?.[0]);
    },
    /** Starts a product draft and never overwrites an existing listing ID. */
    async createDraft(owner,id,draft) {
      ownerId(owner);listingId(id);
      const cols=validatedDraft(draft);
      const r=await pool.query(
        "INSERT INTO videobot_listings (listing_id,seller_user_id,revision,title,price_stars,price_mode,thumbnail_file_id,sample_file_id,sample_duration_seconds,paid_video_file_id,rights_verified,adult_consent_verified,fee_terms_accepted_at,description,creator_terms_version,creator_terms_url,status) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $12 THEN NOW() ELSE NULL END,$13,$14,$15,'draft') ON CONFLICT(listing_id) DO NOTHING RETURNING *",
        [id,owner,...cols]
      );
      if(r?.rowCount!==1)throw new Error('LISTING_ALREADY_EXISTS');
      return recordToListing(r.rows[0]);
    },
    /**
     * Save only private draft/ready data with exact prior revision and owner.
     * Purchased, published, paused and removed assets cannot be overwritten.
     */
    async updateDraft(owner,id,expectedRevision,draft) {
      ownerId(owner);listingId(id);revisionNumber(expectedRevision);
      if(expectedRevision<1)throw new Error('existing revision required');
      const cols=validatedDraft(draft);
      const r=await pool.query(
        "UPDATE videobot_listings SET title=$4,price_stars=$5,price_mode=$6,thumbnail_file_id=$7,sample_file_id=$8,sample_duration_seconds=$9,paid_video_file_id=$10,rights_verified=$11,adult_consent_verified=$12,fee_terms_accepted_at=CASE WHEN $13 THEN NOW() ELSE NULL END,description=$14,creator_terms_version=$15,creator_terms_url=$16,revision=revision+1,updated_at=NOW() WHERE seller_user_id=$1 AND listing_id=$2 AND revision=$3 AND status IN ('draft','ready') RETURNING *",
        [owner,id,expectedRevision,...cols]
      );
      if(r?.rowCount!==1)throw new Error('LISTING_STALE_OR_PUBLISHED');
      return recordToListing(r.rows[0]);
    },
    /** Only call after both real Telegram message IDs have durable receipts. */
    async markPublished(owner,id,expectedRevision,receipt) {
      ownerId(owner);listingId(id);revisionNumber(expectedRevision);
      if(expectedRevision<1 || receipt?.posted!==true ||
         !Array.isArray(receipt.freeMessageIds) ||
         receipt.freeMessageIds.length!==2 ||
         receipt.freeMessageIds.some(x=>!Number.isSafeInteger(x)||x<=0) ||
         !Number.isSafeInteger(receipt.paidMessageId) ||
         receipt.paidMessageId<=0)
        throw new Error('verified publish receipt required');
      const r=await pool.query(
        "UPDATE videobot_listings AS l SET status='published',revision=l.revision+1,updated_at=NOW() WHERE l.seller_user_id=$1 AND l.listing_id=$2 AND l.revision=$3 AND l.status IN ('draft','ready') AND l.rights_verified=TRUE AND l.adult_consent_verified=TRUE AND l.fee_terms_accepted_at IS NOT NULL AND l.creator_terms_version='1.0' AND l.creator_terms_url IS NOT NULL AND l.management_fee_bps=3000 AND l.title<>'' AND l.price_stars IS NOT NULL AND l.thumbnail_file_id IS NOT NULL AND l.sample_file_id IS NOT NULL AND l.paid_video_file_id IS NOT NULL AND EXISTS (SELECT 1 FROM videobot_post_receipts AS r WHERE r.delivery_key=$2||':'||$3::text AND r.listing_id=l.listing_id AND r.revision=$3 AND r.status='sent' AND r.free_message_ids=$4::bigint[] AND r.paid_message_id=$5) RETURNING l.*",
        [owner,id,expectedRevision,receipt.freeMessageIds,receipt.paidMessageId]
      );
      if(r?.rowCount!==1)throw new Error('PUBLISH_RECEIPT_REQUIRES_RECONCILE');
      return recordToListing(r.rows[0]);
    },
    /** Records visibility suppression without deleting purchase/receipts. */
    async removeUnpublished(owner,id,expectedRevision) {
      ownerId(owner);listingId(id);revisionNumber(expectedRevision);
      const r=await pool.query(
        "UPDATE videobot_listings SET status='removed',revision=revision+1,updated_at=NOW() WHERE seller_user_id=$1 AND listing_id=$2 AND revision=$3 AND status IN ('draft','ready') RETURNING listing_id",
        [owner,id,expectedRevision]
      );
      if(r?.rowCount!==1)throw new Error('LISTING_STALE_OR_PUBLISHED');
      return {removed:true,id};
    }
  };
}
