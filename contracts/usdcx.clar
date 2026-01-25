;; USDCx Token Contract (Mock for Testing)
;; SIP-010 Compliant Fungible Token representing bridged USDC on Stacks
;; This is deployed by Circle's xReserve protocol

(impl-trait .sip-010-trait.sip-010-trait)

;; Token definitions
(define-fungible-token usdcx)

;; Constants
(define-constant CONTRACT_OWNER tx-sender)
(define-constant ERR_OWNER_ONLY (err u100))
(define-constant ERR_NOT_TOKEN_OWNER (err u101))
(define-constant ERR_INSUFFICIENT_BALANCE (err u102))

;; SIP-010 Functions

;; Transfer tokens
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_TOKEN_OWNER)
    (try! (ft-transfer? usdcx amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

;; Get token name
(define-read-only (get-name)
  (ok "USDCx")
)

;; Get token symbol
(define-read-only (get-symbol)
  (ok "USDCx")
)

;; Get decimals (6 for USDC compatibility)
(define-read-only (get-decimals)
  (ok u6)
)

;; Get balance of principal
(define-read-only (get-balance (who principal))
  (ok (ft-get-balance usdcx who))
)

;; Get total supply
(define-read-only (get-total-supply)
  (ok (ft-get-supply usdcx))
)

;; Get token URI (metadata)
(define-read-only (get-token-uri)
  (ok (some u"https://circle.com/usdcx"))
)

;; Mint function (only for testing - in production this is controlled by xReserve bridge)
(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_OWNER_ONLY)
    (ft-mint? usdcx amount recipient)
  )
)

;; Burn function (for bridging back to Ethereum)
(define-public (burn (amount uint) (sender principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_NOT_TOKEN_OWNER)
    (ft-burn? usdcx amount sender)
  )
)
