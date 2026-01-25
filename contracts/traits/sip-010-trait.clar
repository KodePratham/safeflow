;; SIP-010 Trait Definition
;; Standard Fungible Token Interface for Stacks
;; Reference: https://github.com/stacksgov/sips/blob/main/sips/sip-010/sip-010-fungible-token-standard.md

(define-trait sip-010-trait
  (
    ;; Transfer from the caller to a new principal
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))

    ;; The human-readable name of the token
    (get-name () (response (string-ascii 32) uint))

    ;; A short ticker symbol for the token
    (get-symbol () (response (string-ascii 32) uint))

    ;; The number of decimals used
    (get-decimals () (response uint uint))

    ;; The balance of the passed principal
    (get-balance (principal) (response uint uint))

    ;; The current total supply
    (get-total-supply () (response uint uint))

    ;; An optional URI for metadata
    (get-token-uri () (response (optional (string-utf8 256)) uint))
  )
)
