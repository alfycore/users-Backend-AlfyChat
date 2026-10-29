// ==========================================
// ALFYCHAT - CLÉS SIGNAL (E2EE) — distribution de clés publiques uniquement
// ==========================================

package users

import (
	"context"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"

	"github.com/alfychat/users/internal/platform"
)

const (
	prekeyPairQuota      = 5
	prekeyRequesterQuota = 60
)

var uuidStrictRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// mayConsumePrekey borne la consommation de one-time prekeys par demandeur.
func (h *handlers) mayConsumePrekey(ctx context.Context, requesterID, targetID string) bool {
	pairKey := "prekeyfetch:" + requesterID + ":" + targetID
	reqKey := "prekeyfetch:" + requesterID
	pairStr, err := h.rget(ctx, pairKey)
	if err != nil {
		return false
	}
	totalStr, err := h.rget(ctx, reqKey)
	if err != nil {
		return false
	}
	pair, total := int(num(pairStr)), int(num(totalStr))
	if pair >= prekeyPairQuota || total >= prekeyRequesterQuota {
		return false
	}
	if h.rset(ctx, pairKey, strconv.Itoa(pair+1), 3600) != nil || h.rset(ctx, reqKey, strconv.Itoa(total+1), 3600) != nil {
		return false
	}
	return true
}

func (h *handlers) addOneTimePrekeys(ctx context.Context, userID string, prekeys []any) {
	for _, pk := range prekeys {
		_, _ = h.db.Exec(ctx, "INSERT IGNORE INTO signal_one_time_prekeys (user_id, prekey_id, prekey_public) VALUES (?, ?, ?)",
			userID, platform.SQLParam(platform.GetPath(pk, "keyId")), platform.SQLParam(platform.GetPath(pk, "publicKey")))
	}
}

func (h *handlers) prekeyCount(ctx context.Context, userID string) (any, error) {
	row, err := h.db.First(ctx, "SELECT COUNT(*) as cnt FROM signal_one_time_prekeys WHERE user_id = ?", userID)
	if err != nil || row == nil {
		return 0, err
	}
	return row.Get("cnt"), nil
}

func (h *handlers) hasSignalBundle(ctx context.Context, userID string) (bool, error) {
	rows, err := h.db.Rows(ctx, "SELECT 1 FROM signal_key_bundles WHERE user_id = ? LIMIT 1", userID)
	return len(rows) > 0, err
}

func (h *handlers) apiKeysPublish(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("registrationId").IsInt(platform.Min(1)).WithMessage("registrationId requis"),
		platform.BodyField("identityKey").IsString().NotEmpty().WithMessage("identityKey requis"),
		platform.BodyField("signedPrekey.keyId").IsInt(platform.Min(0)).WithMessage("signedPrekey.keyId requis"),
		platform.BodyField("signedPrekey.publicKey").IsString().NotEmpty().WithMessage("signedPrekey.publicKey requis"),
		platform.BodyField("signedPrekey.signature").IsString().NotEmpty().WithMessage("signedPrekey.signature requis"),
		platform.BodyField("prekeys").Optional().IsArray(-1, -1),
	) {
		return
	}
	ctx := r.Context()
	reg, identity, ecdh := field(r, "registrationId"), field(r, "identityKey"), field(r, "ecdhKey")
	spID := platform.GetPath(platform.Body(r), "signedPrekey.keyId")
	spPub := platform.GetPath(platform.Body(r), "signedPrekey.publicKey")
	spSig := platform.GetPath(platform.Body(r), "signedPrekey.signature")
	if !platform.Truthy(reg) || !platform.Truthy(identity) || undef(spID) || !platform.Truthy(spPub) || !platform.Truthy(spSig) {
		platform.Error(w, 400, "Bundle Signal incomplet")
		return
	}
	var ecdhArg any
	if !undef(ecdh) && ecdh != nil {
		ecdhArg = platform.SQLParam(ecdh)
	}
	if _, err := h.db.Exec(ctx, `INSERT INTO signal_key_bundles
         (user_id, registration_id, identity_key, ecdh_key, signed_prekey_id, signed_prekey_public, signed_prekey_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         registration_id        = VALUES(registration_id),
         identity_key           = VALUES(identity_key),
         ecdh_key               = VALUES(ecdh_key),
         signed_prekey_id       = VALUES(signed_prekey_id),
         signed_prekey_public   = VALUES(signed_prekey_public),
         signed_prekey_signature = VALUES(signed_prekey_signature),
         updated_at             = NOW()`,
		uid(r), platform.SQLParam(reg), platform.SQLParam(identity), ecdhArg, platform.SQLParam(spID), platform.SQLParam(spPub), platform.SQLParam(spSig)); err != nil {
		slog.Error("[Signal] Erreur publication bundle:", "err", err)
		serverError(w)
		return
	}
	if list, ok := field(r, "prekeys").([]any); ok && len(list) > 0 {
		h.addOneTimePrekeys(ctx, uid(r), list)
	}
	count, err := h.prekeyCount(ctx, uid(r))
	if err != nil {
		slog.Error("[Signal] Erreur publication bundle:", "err", err)
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "prekeyCount", count))
}

func (h *handlers) apiKeysStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	count, err := h.prekeyCount(ctx, uid(r))
	if err != nil {
		serverError(w)
		return
	}
	row, err := h.db.First(ctx, "SELECT ecdh_key FROM signal_key_bundles WHERE user_id = ? LIMIT 1", uid(r))
	if err != nil {
		serverError(w)
		return
	}
	hasBundle, hasEcdh := row != nil, row != nil && row.Bool("ecdh_key")
	platform.JSON(w, 200, platform.O("hasBundle", hasBundle, "hasEcdhKey", hasEcdh, "prekeyCount", count))
}

func (h *handlers) apiKeysGetBundle(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	target := r.PathValue("userId")
	consume := uid(r) != target && h.mayConsumePrekey(ctx, uid(r), target)
	bundle, err := h.db.First(ctx, `SELECT user_id, registration_id, identity_key, ecdh_key,
              signed_prekey_id, signed_prekey_public, signed_prekey_signature
       FROM signal_key_bundles
       WHERE user_id = ?`, target)
	if err != nil {
		slog.Error("[Signal] Erreur récupération bundle:", "err", err)
		serverError(w)
		return
	}
	if bundle == nil {
		platform.Error(w, 404, "Aucun bundle Signal pour cet utilisateur")
		return
	}
	pk, err := h.db.First(ctx, `SELECT id, prekey_id, prekey_public
       FROM signal_one_time_prekeys
       WHERE user_id = ?
       ORDER BY id ASC
       LIMIT 1`, target)
	if err != nil {
		slog.Error("[Signal] Erreur récupération bundle:", "err", err)
		serverError(w)
		return
	}
	var prekey any = platform.Undefined
	if consume && pk != nil {
		if _, err := h.db.Exec(ctx, "DELETE FROM signal_one_time_prekeys WHERE id = ?", pk.Get("id")); err != nil {
			slog.Error("[Signal] Erreur récupération bundle:", "err", err)
			serverError(w)
			return
		}
		prekey = platform.O("keyId", pk.Get("prekey_id"), "publicKey", pk.Get("prekey_public"))
	}
	var ecdh any = platform.Undefined
	if v := bundle.Get("ecdh_key"); v != nil {
		ecdh = v
	}
	platform.JSON(w, 200, platform.O("userId", bundle.Get("user_id"), "registrationId", bundle.Get("registration_id"),
		"identityKey", bundle.Get("identity_key"), "ecdhKey", ecdh,
		"signedPrekey", platform.O("keyId", bundle.Get("signed_prekey_id"), "publicKey", bundle.Get("signed_prekey_public"), "signature", bundle.Get("signed_prekey_signature")),
		"prekey", prekey))
}

func (h *handlers) apiKeysAddPrekeys(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("prekeys").IsArray(1, -1).WithMessage("prekeys requis (tableau non vide)")) {
		return
	}
	list, ok := field(r, "prekeys").([]any)
	if !ok || len(list) == 0 {
		platform.Error(w, 400, "prekeys requis (tableau non vide)")
		return
	}
	ctx := r.Context()
	h.addOneTimePrekeys(ctx, uid(r), list)
	count, err := h.prekeyCount(ctx, uid(r))
	if err != nil {
		slog.Error("[Signal] Erreur ajout prekeys:", "err", err)
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "prekeyCount", count))
}

func (h *handlers) apiKeysEcdhBatch(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("userIds").IsArray(1, 100).WithMessage("userIds requis (1 à 100)")) {
		return
	}
	raw, _ := field(r, "userIds").([]any)
	seen := map[string]bool{}
	var ids []string
	for _, v := range raw {
		if s, ok := v.(string); ok && uuidStrictRe.MatchString(s) && !seen[s] {
			seen[s] = true
			ids = append(ids, s)
		}
	}
	if len(ids) > 100 {
		ids = ids[:100]
	}
	out := platform.O()
	for _, id := range ids {
		out.Set(id, nil)
	}
	if len(ids) > 0 {
		rows, err := h.db.Rows(r.Context(), "SELECT user_id, ecdh_key FROM signal_key_bundles WHERE user_id IN ("+platform.Placeholders(len(ids))+")", platform.Args(ids)...)
		if err != nil {
			slog.Error("[Signal] Erreur lecture clés ECDH:", "err", err)
			serverError(w)
			return
		}
		for _, row := range rows {
			out.Set(row.Str("user_id"), coalesceNil(row.Get("ecdh_key")))
		}
	}
	platform.JSON(w, 200, platform.O("keys", out))
}

func (h *handlers) apiKeysUpdateEcdh(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("ecdhKey").IsString().NotEmpty().WithMessage("ecdhKey requis")) {
		return
	}
	ctx := r.Context()
	key, ok := field(r, "ecdhKey").(string)
	if !ok || key == "" {
		platform.Error(w, 400, "ecdhKey requis (string base64)")
		return
	}
	has, err := h.hasSignalBundle(ctx, uid(r))
	if err != nil {
		slog.Error("[Signal] Erreur mise à jour clé ECDH:", "err", err)
		serverError(w)
		return
	}
	if !has {
		platform.Error(w, 400, "Aucun bundle Signal existant")
		return
	}
	if _, err := h.db.Exec(ctx, "UPDATE signal_key_bundles SET ecdh_key = ?, updated_at = NOW() WHERE user_id = ?", key, uid(r)); err != nil {
		slog.Error("[Signal] Erreur mise à jour clé ECDH:", "err", err)
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiKeysUploadPrivate(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("encryptedBundle").IsString().NotEmpty().WithMessage("encryptedBundle requis")) {
		return
	}
	ctx := r.Context()
	blob, ok := field(r, "encryptedBundle").(string)
	if !ok || blob == "" {
		platform.Error(w, 400, "encryptedBundle requis (string)")
		return
	}
	has, err := h.hasSignalBundle(ctx, uid(r))
	if err != nil {
		slog.Error("[Signal] Erreur stockage bundle privé:", "err", err)
		serverError(w)
		return
	}
	if !has {
		platform.Error(w, 400, "Aucun bundle Signal public trouvé. Publiez d'abord vos clés publiques.")
		return
	}
	if _, err := h.db.Exec(ctx, "UPDATE signal_key_bundles SET encrypted_private_bundle = ?, updated_at = NOW() WHERE user_id = ?", blob, uid(r)); err != nil {
		slog.Error("[Signal] Erreur stockage bundle privé:", "err", err)
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiKeysDownloadPrivate(w http.ResponseWriter, r *http.Request) {
	row, err := h.db.First(r.Context(), "SELECT encrypted_private_bundle FROM signal_key_bundles WHERE user_id = ?", uid(r))
	if err != nil {
		slog.Error("[Signal] Erreur récupération bundle privé:", "err", err)
		serverError(w)
		return
	}
	var blob any
	if row != nil && platform.Truthy(row.Get("encrypted_private_bundle")) {
		blob = row.Get("encrypted_private_bundle")
	}
	platform.JSON(w, 200, platform.O("encryptedBundle", blob))
}
