;; SafeFlow - Cross-Chain Programmable Payment Streams
;; Create, manage, freeze, and cancel USDCx payment streams on Stacks
;; Anyone can create a SafeFlow, admin has full control over their streams

;; ============================================
;; TRAITS & CONSTANTS
;; ============================================

(use-trait ft-trait .sip-010-trait.sip-010-trait)

;; USDCx Token Contract Principal (update after deployment)
(define-constant USDCX_CONTRACT 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx)

;; Error Codes
(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_SAFEFLOW_NOT_FOUND (err u101))
(define-constant ERR_SAFEFLOW_ALREADY_EXISTS (err u102))
(define-constant ERR_INVALID_AMOUNT (err u103))
(define-constant ERR_INVALID_RATE (err u104))
(define-constant ERR_SAFEFLOW_INACTIVE (err u105))
(define-constant ERR_NO_CLAIMABLE (err u106))
(define-constant ERR_TRANSFER_FAILED (err u107))
(define-constant ERR_SAFEFLOW_FROZEN (err u108))
(define-constant ERR_SAFEFLOW_CANCELLED (err u109))
(define-constant ERR_SAFEFLOW_NOT_FROZEN (err u110))

;; Time constants (Bitcoin blocks)
;; ~144 blocks per day (10 min/block)
;; ~4320 blocks per month (30 days)
(define-constant BLOCKS_PER_DAY u144)
(define-constant BLOCKS_PER_MONTH u4320)

;; SafeFlow statuses
(define-constant STATUS_ACTIVE u1)
(define-constant STATUS_FROZEN u2)
(define-constant STATUS_CANCELLED u3)

;; ============================================
;; DATA MAPS & VARIABLES
;; ============================================

;; SafeFlow counter for unique IDs
(define-data-var safeflow-nonce uint u0)

;; SafeFlow stream data - indexed by ID
(define-map safeflows
  { id: uint }
  {
    admin: principal,             ;; Creator/Admin who can manage this SafeFlow
    recipient: principal,         ;; Address receiving the dripped USDCx
    title: (string-utf8 50),      ;; Title of the SafeFlow
    description: (string-utf8 200), ;; Detailed description
    total-amount: uint,           ;; Total USDCx allocated
    claimed-amount: uint,         ;; Amount already claimed by recipient
    drip-rate: uint,              ;; Micro-USDCx per block
    drip-interval: (string-ascii 10),  ;; "daily" or "monthly"
    start-block: uint,            ;; Bitcoin block when stream started
    last-claim-block: uint,       ;; Last block a claim was made
    status: uint,                 ;; 1=active, 2=frozen, 3=cancelled
    created-at: uint              ;; Block when SafeFlow was created
  }
)

;; Map recipient to their SafeFlow IDs
(define-map recipient-safeflows
  { recipient: principal, index: uint }
  { id: uint }
)

;; Count of SafeFlows per recipient
(define-map recipient-safeflow-count
  { recipient: principal }
  uint
)

;; Map admin to their created SafeFlow IDs
(define-map admin-safeflows
  { admin: principal, index: uint }
  { id: uint }
)

;; Count of SafeFlows created by each admin
(define-map admin-safeflow-count
  { admin: principal }
  uint
)

;; Total stats
(define-data-var total-allocated uint u0)
(define-data-var total-claimed uint u0)
(define-data-var active-safeflows uint u0)
(define-data-var total-safeflows uint u0)

;; ============================================
;; PRIVATE HELPER FUNCTIONS
;; ============================================

;; Helper function for min of two uints
(define-private (min (a uint) (b uint))
  (if (<= a b) a b)
)

(define-private (is-safeflow-admin (safeflow-id uint))
  (match (map-get? safeflows { id: safeflow-id })
    sf (is-eq tx-sender (get admin sf))
    false
  )
)

;; ============================================
;; READ-ONLY FUNCTIONS (PUBLIC VERIFICATION)
;; ============================================

;; Get SafeFlow by ID
(define-read-only (get-safeflow (id uint))
  (map-get? safeflows { id: id })
)

;; Check if a SafeFlow is active
(define-read-only (is-safeflow-active (id uint))
  (match (get-safeflow id)
    sf (is-eq (get status sf) STATUS_ACTIVE)
    false
  )
)

;; Check if a SafeFlow is frozen
(define-read-only (is-safeflow-frozen (id uint))
  (match (get-safeflow id)
    sf (is-eq (get status sf) STATUS_FROZEN)
    false
  )
)

;; Calculate claimable amount for a SafeFlow
(define-read-only (get-claimable-amount (id uint))
  (match (get-safeflow id)
    sf
      (if (is-eq (get status sf) STATUS_ACTIVE)
        (let
          (
            (current-block burn-block-height)
            (last-claim (get last-claim-block sf))
            (drip-rate (get drip-rate sf))
            (total-amount (get total-amount sf))
            (claimed-amount (get claimed-amount sf))
            (remaining (- total-amount claimed-amount))
          )
          (if (> current-block last-claim)
            (let
              (
                (blocks-elapsed (- current-block last-claim))
                (earned (min (* blocks-elapsed drip-rate) remaining))
              )
              (ok earned)
            )
            (ok u0)
          )
        )
        (ok u0)
      )
    (ok u0)
  )
)

;; Get SafeFlow progress percentage
(define-read-only (get-safeflow-progress (id uint))
  (match (get-safeflow id)
    sf
      (let
        (
          (total (get total-amount sf))
          (claimed (get claimed-amount sf))
        )
        (if (> total u0)
          (ok (/ (* claimed u100) total))
          (ok u0)
        )
      )
    (ok u0)
  )
)

;; Get remaining amount in SafeFlow
(define-read-only (get-remaining-amount (id uint))
  (match (get-safeflow id)
    sf (ok (- (get total-amount sf) (get claimed-amount sf)))
    (ok u0)
  )
)

;; Get total stats
(define-read-only (get-stats)
  {
    total-allocated: (var-get total-allocated),
    total-claimed: (var-get total-claimed),
    active-safeflows: (var-get active-safeflows),
    total-safeflows: (var-get total-safeflows)
  }
)

;; Get SafeFlow count for a recipient
(define-read-only (get-recipient-safeflow-count (recipient principal))
  (default-to u0 (map-get? recipient-safeflow-count { recipient: recipient }))
)

;; Get SafeFlow ID for a recipient by index
(define-read-only (get-recipient-safeflow-id (recipient principal) (index uint))
  (map-get? recipient-safeflows { recipient: recipient, index: index })
)

;; Get SafeFlow count for an admin
(define-read-only (get-admin-safeflow-count (admin principal))
  (default-to u0 (map-get? admin-safeflow-count { admin: admin }))
)

;; Get SafeFlow ID created by an admin at index
(define-read-only (get-admin-safeflow-id (admin principal) (index uint))
  (map-get? admin-safeflows { admin: admin, index: index })
)

;; Get current nonce (next SafeFlow ID)
(define-read-only (get-next-safeflow-id)
  (var-get safeflow-nonce)
)

;; Convert drip-per-day/month to per-block rate
(define-read-only (calculate-drip-rate (amount-per-period uint) (interval (string-ascii 10)))
  (if (is-eq interval "daily")
    (/ amount-per-period BLOCKS_PER_DAY)
    (if (is-eq interval "monthly")
      (/ amount-per-period BLOCKS_PER_MONTH)
      u0
    )
  )
)

;; ============================================
;; PUBLIC FUNCTIONS - CREATE SAFEFLOW
;; ============================================

;; Create a new SafeFlow stream (anyone can create)
;; @param token-contract: USDCx token contract
;; @param recipient: Address to receive the dripped payments
;; @param title: Title of the SafeFlow
;; @param description: Description of the SafeFlow
;; @param total-amount: Total USDCx to stream (in micro-units, 6 decimals)
;; @param drip-amount: Amount to drip per period (in micro-units)
;; @param interval: "daily" or "monthly"
(define-public (create-safeflow
    (token-contract <ft-trait>)
    (recipient principal)
    (title (string-utf8 50))
    (description (string-utf8 200))
    (total-amount uint)
    (drip-amount uint)
    (interval (string-ascii 10))
  )
  (let
    (
      (drip-rate (calculate-drip-rate drip-amount interval))
      (safeflow-id (var-get safeflow-nonce))
      (admin-count (get-admin-safeflow-count tx-sender))
      (recipient-count (get-recipient-safeflow-count recipient))
    )
    ;; Validate inputs
    (asserts! (> total-amount u0) ERR_INVALID_AMOUNT)
    (asserts! (> drip-rate u0) ERR_INVALID_RATE)
    
    ;; Transfer USDCx from creator to contract
    (try! (contract-call? token-contract transfer
      total-amount
      tx-sender
      (as-contract tx-sender)
      none
    ))
    
    ;; Create SafeFlow record
    (map-set safeflows
      { id: safeflow-id }
      {
        admin: tx-sender,
        recipient: recipient,
        title: title,
        description: description,
        total-amount: total-amount,
        claimed-amount: u0,
        drip-rate: drip-rate,
        drip-interval: interval,
        start-block: burn-block-height,
        last-claim-block: burn-block-height,
        status: STATUS_ACTIVE,
        created-at: burn-block-height
      }
    )
    
    ;; Index for admin
    (map-set admin-safeflows
      { admin: tx-sender, index: admin-count }
      { id: safeflow-id }
    )
    (map-set admin-safeflow-count
      { admin: tx-sender }
      (+ admin-count u1)
    )
    
    ;; Index for recipient
    (map-set recipient-safeflows
      { recipient: recipient, index: recipient-count }
      { id: safeflow-id }
    )
    (map-set recipient-safeflow-count
      { recipient: recipient }
      (+ recipient-count u1)
    )
    
    ;; Update stats
    (var-set safeflow-nonce (+ safeflow-id u1))
    (var-set total-allocated (+ (var-get total-allocated) total-amount))
    (var-set active-safeflows (+ (var-get active-safeflows) u1))
    (var-set total-safeflows (+ (var-get total-safeflows) u1))
    
    (ok {
      id: safeflow-id,
      admin: tx-sender,
      recipient: recipient,
      total-amount: total-amount,
      drip-rate: drip-rate,
      interval: interval,
      start-block: burn-block-height
    })
  )
)

;; ============================================
;; ADMIN FUNCTIONS - MANAGE SAFEFLOW
;; ============================================

;; Freeze a SafeFlow stream (stops dripping but retains funds)
(define-public (freeze-safeflow (id uint))
  (let
    (
      (sf (unwrap! (get-safeflow id) ERR_SAFEFLOW_NOT_FOUND))
    )
    (asserts! (is-safeflow-admin id) ERR_UNAUTHORIZED)
    (asserts! (is-eq (get status sf) STATUS_ACTIVE) ERR_SAFEFLOW_INACTIVE)
    
    (map-set safeflows
      { id: id }
      (merge sf { status: STATUS_FROZEN })
    )
    
    (var-set active-safeflows (- (var-get active-safeflows) u1))
    
    (ok { id: id, status: "frozen" })
  )
)

;; Unfreeze a SafeFlow stream
(define-public (unfreeze-safeflow (id uint))
  (let
    (
      (sf (unwrap! (get-safeflow id) ERR_SAFEFLOW_NOT_FOUND))
    )
    (asserts! (is-safeflow-admin id) ERR_UNAUTHORIZED)
    (asserts! (is-eq (get status sf) STATUS_FROZEN) ERR_SAFEFLOW_NOT_FROZEN)
    
    ;; Resume from current block to avoid accumulating during freeze
    (map-set safeflows
      { id: id }
      (merge sf { 
        status: STATUS_ACTIVE,
        last-claim-block: burn-block-height
      })
    )
    
    (var-set active-safeflows (+ (var-get active-safeflows) u1))
    
    (ok { id: id, status: "active" })
  )
)

;; Cancel SafeFlow and return remaining USDCx to admin
(define-public (cancel-safeflow
    (token-contract <ft-trait>)
    (id uint)
  )
  (let
    (
      (sf (unwrap! (get-safeflow id) ERR_SAFEFLOW_NOT_FOUND))
      (remaining (- (get total-amount sf) (get claimed-amount sf)))
      (admin (get admin sf))
    )
    (asserts! (is-safeflow-admin id) ERR_UNAUTHORIZED)
    (asserts! (not (is-eq (get status sf) STATUS_CANCELLED)) ERR_SAFEFLOW_CANCELLED)
    
    ;; Return remaining USDCx to admin
    (if (> remaining u0)
      (try! (as-contract (contract-call? token-contract transfer
        remaining
        tx-sender
        admin
        none
      )))
      true
    )
    
    ;; Mark as cancelled
    (map-set safeflows
      { id: id }
      (merge sf { status: STATUS_CANCELLED })
    )
    
    ;; Update stats if was active
    (if (is-eq (get status sf) STATUS_ACTIVE)
      (var-set active-safeflows (- (var-get active-safeflows) u1))
      true
    )
    
    (ok { 
      id: id, 
      status: "cancelled",
      returned-amount: remaining,
      returned-to: admin
    })
  )
)

;; Update drip rate for a SafeFlow
(define-public (update-drip-rate 
    (id uint)
    (new-drip-amount uint)
    (interval (string-ascii 10))
  )
  (let
    (
      (sf (unwrap! (get-safeflow id) ERR_SAFEFLOW_NOT_FOUND))
      (new-rate (calculate-drip-rate new-drip-amount interval))
    )
    (asserts! (is-safeflow-admin id) ERR_UNAUTHORIZED)
    (asserts! (> new-rate u0) ERR_INVALID_RATE)
    (asserts! (not (is-eq (get status sf) STATUS_CANCELLED)) ERR_SAFEFLOW_CANCELLED)
    
    (map-set safeflows
      { id: id }
      (merge sf { 
        drip-rate: new-rate,
        drip-interval: interval
      })
    )
    
    (ok { id: id, new-drip-rate: new-rate })
  )
)

;; Update title and description
(define-public (update-safeflow-info
    (id uint)
    (new-title (string-utf8 50))
    (new-description (string-utf8 200))
  )
  (let
    (
      (sf (unwrap! (get-safeflow id) ERR_SAFEFLOW_NOT_FOUND))
    )
    (asserts! (is-safeflow-admin id) ERR_UNAUTHORIZED)
    (asserts! (not (is-eq (get status sf) STATUS_CANCELLED)) ERR_SAFEFLOW_CANCELLED)
    
    (map-set safeflows
      { id: id }
      (merge sf { 
        title: new-title,
        description: new-description
      })
    )
    
    (ok { id: id, title: new-title })
  )
)

;; Add more funds to an existing SafeFlow
(define-public (add-funds
    (token-contract <ft-trait>)
    (id uint)
    (additional-amount uint)
  )
  (let
    (
      (sf (unwrap! (get-safeflow id) ERR_SAFEFLOW_NOT_FOUND))
    )
    (asserts! (is-safeflow-admin id) ERR_UNAUTHORIZED)
    (asserts! (> additional-amount u0) ERR_INVALID_AMOUNT)
    (asserts! (not (is-eq (get status sf) STATUS_CANCELLED)) ERR_SAFEFLOW_CANCELLED)
    
    ;; Transfer additional USDCx
    (try! (contract-call? token-contract transfer
      additional-amount
      tx-sender
      (as-contract tx-sender)
      none
    ))
    
    ;; Update SafeFlow
    (map-set safeflows
      { id: id }
      (merge sf {
        total-amount: (+ (get total-amount sf) additional-amount)
      })
    )
    
    (var-set total-allocated (+ (var-get total-allocated) additional-amount))
    
    (ok { 
      id: id, 
      new-total: (+ (get total-amount sf) additional-amount) 
    })
  )
)

;; ============================================
;; RECIPIENT FUNCTIONS
;; ============================================

;; Claim available dripped funds from a SafeFlow
(define-public (claim (token-contract <ft-trait>) (id uint))
  (let
    (
      (recipient tx-sender)
      (sf (unwrap! (get-safeflow id) ERR_SAFEFLOW_NOT_FOUND))
      (claimable (unwrap! (get-claimable-amount id) ERR_SAFEFLOW_NOT_FOUND))
    )
    ;; Only recipient can claim
    (asserts! (is-eq recipient (get recipient sf)) ERR_UNAUTHORIZED)
    ;; Validate SafeFlow is active
    (asserts! (is-eq (get status sf) STATUS_ACTIVE) ERR_SAFEFLOW_INACTIVE)
    ;; Ensure there's something to claim
    (asserts! (> claimable u0) ERR_NO_CLAIMABLE)
    
    ;; Transfer claimable amount to recipient
    (try! (as-contract (contract-call? token-contract transfer
      claimable
      tx-sender
      recipient
      none
    )))
    
    ;; Update SafeFlow state
    (map-set safeflows
      { id: id }
      (merge sf {
        claimed-amount: (+ (get claimed-amount sf) claimable),
        last-claim-block: burn-block-height
      })
    )
    
    ;; Update stats
    (var-set total-claimed (+ (var-get total-claimed) claimable))
    
    (ok {
      id: id,
      claimed: claimable,
      remaining: (- (get total-amount sf) (+ (get claimed-amount sf) claimable)),
      next-claim-available: (+ burn-block-height u1)
    })
  )
)
