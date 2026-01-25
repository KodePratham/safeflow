;; DevPayments - Developer Payment Streaming Contract
;; Public registry for developer payments with drip functionality
;; Admin creates payment streams, developers can verify and claim

;; ============================================
;; TRAITS & CONSTANTS
;; ============================================

(use-trait ft-trait 'ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT.sip-010-trait-ft-standard.sip-010-trait)

;; Contract deployer is the admin
(define-constant CONTRACT_ADMIN tx-sender)

;; USDCx Token Contract Principal (update after deployment)
(define-constant USDCX_CONTRACT 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx)

;; Error Codes
(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_PAYMENT_NOT_FOUND (err u101))
(define-constant ERR_PAYMENT_ALREADY_EXISTS (err u102))
(define-constant ERR_INVALID_AMOUNT (err u103))
(define-constant ERR_INVALID_RATE (err u104))
(define-constant ERR_PAYMENT_INACTIVE (err u105))
(define-constant ERR_NO_CLAIMABLE (err u106))
(define-constant ERR_TRANSFER_FAILED (err u107))

;; Time constants (Bitcoin blocks)
;; ~144 blocks per day (10 min/block)
;; ~4320 blocks per month (30 days)
(define-constant BLOCKS_PER_DAY u144)
(define-constant BLOCKS_PER_MONTH u4320)

;; ============================================
;; DATA MAPS & VARIABLES
;; ============================================

;; Payment stream data - publicly queryable by recipient address
(define-map payments
  { recipient: principal }
  {
    total-amount: uint,           ;; Total USDCx allocated to developer
    claimed-amount: uint,         ;; Amount already claimed
    drip-rate: uint,              ;; Micro-USDCx per block
    drip-interval: (string-ascii 10),  ;; "daily" or "monthly"
    start-block: uint,            ;; Bitcoin block when payments started
    last-claim-block: uint,       ;; Last block a claim was made
    is-active: bool,              ;; Whether payment stream is active
    description: (string-utf8 100)  ;; Payment description (project name, etc.)
  }
)

;; List of all recipients for enumeration
(define-data-var recipient-count uint u0)
(define-map recipient-index uint principal)

;; Total stats
(define-data-var total-allocated uint u0)
(define-data-var total-claimed uint u0)
(define-data-var active-payments uint u0)

;; ============================================
;; ADMIN-ONLY MODIFIER
;; ============================================

(define-private (is-admin)
  (is-eq tx-sender CONTRACT_ADMIN)
)

;; ============================================
;; READ-ONLY FUNCTIONS (PUBLIC VERIFICATION)
;; ============================================

;; Get payment details for a recipient (publicly accessible)
(define-read-only (get-payment (recipient principal))
  (map-get? payments { recipient: recipient })
)

;; Check if a recipient has an active payment
(define-read-only (has-active-payment (recipient principal))
  (match (get-payment recipient)
    payment (get is-active payment)
    false
  )
)

;; Calculate claimable amount for a recipient
(define-read-only (get-claimable-amount (recipient principal))
  (match (get-payment recipient)
    payment
      (if (get is-active payment)
        (let
          (
            (current-block burn-block-height)
            (last-claim (get last-claim-block payment))
            (drip-rate (get drip-rate payment))
            (total-amount (get total-amount payment))
            (claimed-amount (get claimed-amount payment))
            (remaining (- total-amount claimed-amount))
          )
          ;; Calculate blocks since last claim
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

;; Get payment progress percentage
(define-read-only (get-payment-progress (recipient principal))
  (match (get-payment recipient)
    payment
      (let
        (
          (total (get total-amount payment))
          (claimed (get claimed-amount payment))
        )
        (if (> total u0)
          (ok (/ (* claimed u100) total))
          (ok u0)
        )
      )
    (ok u0)
  )
)

;; Get remaining amount
(define-read-only (get-remaining-amount (recipient principal))
  (match (get-payment recipient)
    payment (ok (- (get total-amount payment) (get claimed-amount payment)))
    (ok u0)
  )
)

;; Get contract admin
(define-read-only (get-admin)
  CONTRACT_ADMIN
)

;; Get total stats
(define-read-only (get-stats)
  {
    total-allocated: (var-get total-allocated),
    total-claimed: (var-get total-claimed),
    active-payments: (var-get active-payments),
    recipient-count: (var-get recipient-count)
  }
)

;; Get recipient by index (for enumeration)
(define-read-only (get-recipient-by-index (index uint))
  (map-get? recipient-index index)
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
;; ADMIN FUNCTIONS
;; ============================================

;; Create a new developer payment stream
;; @param recipient: Developer's Stacks address
;; @param total-amount: Total USDCx to pay (in micro-units, 6 decimals)
;; @param drip-amount: Amount to drip per period (in micro-units)
;; @param interval: "daily" or "monthly"
;; @param description: Description of the payment
(define-public (create-payment
    (token-contract <ft-trait>)
    (recipient principal)
    (total-amount uint)
    (drip-amount uint)
    (interval (string-ascii 10))
    (description (string-utf8 100))
  )
  (let
    (
      (drip-rate (calculate-drip-rate drip-amount interval))
      (current-count (var-get recipient-count))
    )
    ;; Only admin can create payments
    (asserts! (is-admin) ERR_UNAUTHORIZED)
    ;; Validate inputs
    (asserts! (> total-amount u0) ERR_INVALID_AMOUNT)
    (asserts! (> drip-rate u0) ERR_INVALID_RATE)
    ;; Check payment doesn't already exist
    (asserts! (is-none (get-payment recipient)) ERR_PAYMENT_ALREADY_EXISTS)
    
    ;; Transfer USDCx from admin to contract
    (try! (contract-call? token-contract transfer
      total-amount
      tx-sender
      (as-contract tx-sender)
      none
    ))
    
    ;; Create payment record
    (map-set payments
      { recipient: recipient }
      {
        total-amount: total-amount,
        claimed-amount: u0,
        drip-rate: drip-rate,
        drip-interval: interval,
        start-block: burn-block-height,
        last-claim-block: burn-block-height,
        is-active: true,
        description: description
      }
    )
    
    ;; Add to recipient list
    (map-set recipient-index current-count recipient)
    (var-set recipient-count (+ current-count u1))
    
    ;; Update stats
    (var-set total-allocated (+ (var-get total-allocated) total-amount))
    (var-set active-payments (+ (var-get active-payments) u1))
    
    (ok {
      recipient: recipient,
      total-amount: total-amount,
      drip-rate: drip-rate,
      interval: interval,
      start-block: burn-block-height
    })
  )
)

;; Pause a payment stream
(define-public (pause-payment (recipient principal))
  (let
    (
      (payment (unwrap! (get-payment recipient) ERR_PAYMENT_NOT_FOUND))
    )
    (asserts! (is-admin) ERR_UNAUTHORIZED)
    (asserts! (get is-active payment) ERR_PAYMENT_INACTIVE)
    
    (map-set payments
      { recipient: recipient }
      (merge payment { is-active: false })
    )
    
    (var-set active-payments (- (var-get active-payments) u1))
    
    (ok true)
  )
)

;; Resume a paused payment stream
(define-public (resume-payment (recipient principal))
  (let
    (
      (payment (unwrap! (get-payment recipient) ERR_PAYMENT_NOT_FOUND))
    )
    (asserts! (is-admin) ERR_UNAUTHORIZED)
    (asserts! (not (get is-active payment)) ERR_PAYMENT_ALREADY_EXISTS)
    
    ;; Resume from current block to avoid accumulating during pause
    (map-set payments
      { recipient: recipient }
      (merge payment { 
        is-active: true,
        last-claim-block: burn-block-height
      })
    )
    
    (var-set active-payments (+ (var-get active-payments) u1))
    
    (ok true)
  )
)

;; Update drip rate for a payment
(define-public (update-drip-rate 
    (recipient principal)
    (new-drip-amount uint)
    (interval (string-ascii 10))
  )
  (let
    (
      (payment (unwrap! (get-payment recipient) ERR_PAYMENT_NOT_FOUND))
      (new-rate (calculate-drip-rate new-drip-amount interval))
    )
    (asserts! (is-admin) ERR_UNAUTHORIZED)
    (asserts! (> new-rate u0) ERR_INVALID_RATE)
    
    (map-set payments
      { recipient: recipient }
      (merge payment { 
        drip-rate: new-rate,
        drip-interval: interval
      })
    )
    
    (ok new-rate)
  )
)

;; Add more funds to an existing payment
(define-public (add-funds
    (token-contract <ft-trait>)
    (recipient principal)
    (additional-amount uint)
  )
  (let
    (
      (payment (unwrap! (get-payment recipient) ERR_PAYMENT_NOT_FOUND))
    )
    (asserts! (is-admin) ERR_UNAUTHORIZED)
    (asserts! (> additional-amount u0) ERR_INVALID_AMOUNT)
    
    ;; Transfer additional USDCx
    (try! (contract-call? token-contract transfer
      additional-amount
      tx-sender
      (as-contract tx-sender)
      none
    ))
    
    ;; Update payment
    (map-set payments
      { recipient: recipient }
      (merge payment {
        total-amount: (+ (get total-amount payment) additional-amount)
      })
    )
    
    (var-set total-allocated (+ (var-get total-allocated) additional-amount))
    
    (ok (+ (get total-amount payment) additional-amount))
  )
)

;; ============================================
;; RECIPIENT FUNCTIONS
;; ============================================

;; Claim available dripped funds (called by recipient)
(define-public (claim (token-contract <ft-trait>))
  (let
    (
      (recipient tx-sender)
      (payment (unwrap! (get-payment recipient) ERR_PAYMENT_NOT_FOUND))
      (claimable (unwrap! (get-claimable-amount recipient) ERR_PAYMENT_NOT_FOUND))
    )
    ;; Validate payment is active
    (asserts! (get is-active payment) ERR_PAYMENT_INACTIVE)
    ;; Ensure there's something to claim
    (asserts! (> claimable u0) ERR_NO_CLAIMABLE)
    
    ;; Transfer claimable amount to recipient
    (try! (as-contract (contract-call? token-contract transfer
      claimable
      tx-sender
      recipient
      none
    )))
    
    ;; Update payment state
    (map-set payments
      { recipient: recipient }
      (merge payment {
        claimed-amount: (+ (get claimed-amount payment) claimable),
        last-claim-block: burn-block-height
      })
    )
    
    ;; Update stats
    (var-set total-claimed (+ (var-get total-claimed) claimable))
    
    (ok {
      claimed: claimable,
      remaining: (- (get total-amount payment) (+ (get claimed-amount payment) claimable)),
      next-claim-available: (+ burn-block-height u1)
    })
  )
)

;; ============================================
;; EMERGENCY ADMIN FUNCTIONS
;; ============================================

;; Emergency withdraw all funds (admin only)
;; Use only in case of emergency/migration
(define-public (emergency-withdraw
    (token-contract <ft-trait>)
    (amount uint)
    (to principal)
  )
  (begin
    (asserts! (is-admin) ERR_UNAUTHORIZED)
    (as-contract (contract-call? token-contract transfer
      amount
      tx-sender
      to
      none
    ))
  )
)
