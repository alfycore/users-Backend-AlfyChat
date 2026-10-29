// ==========================================
// ALFYCHAT - ROUTES WEB PUSH
// ==========================================

package users

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/alfychat/users/internal/platform"
)

var pushHostSuffixes = []string{
	"fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com",
	"notify.windows.com", "push.apple.com", "web.push.apple.com",
}

var expoTokenRe = regexp.MustCompile(`^ExponentPushToken\[[A-Za-z0-9_-]{10,100}\]$`)

// isAllowedPushEndpoint : https, sans identifiants, port 443, hôte d'un service push reconnu.
func isAllowedPushEndpoint(endpoint any) bool {
	s, ok := endpoint.(string)
	if !ok || platform.JSLength(s) > 1024 {
		return false
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, suf := range pushHostSuffixes {
		if host == suf || strings.HasSuffix(host, "."+suf) {
			return true
		}
	}
	return false
}

func pushFail(w http.ResponseWriter, msg string, err error) {
	slog.Error(msg, "err", err)
	platform.Error(w, 500, "Erreur interne")
}

func (h *handlers) apiPushSubscribe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	endpoint, keys, userAgent := field(r, "endpoint"), field(r, "keys"), field(r, "userAgent")
	p256dh, auth := platform.GetPath(keys, "p256dh"), platform.GetPath(keys, "auth")
	if !platform.Truthy(endpoint) || !platform.Truthy(p256dh) || !platform.Truthy(auth) {
		platform.Error(w, 400, "endpoint, keys.p256dh et keys.auth sont requis")
		return
	}
	if !isAllowedPushEndpoint(endpoint) {
		platform.Error(w, 400, "Service push non reconnu")
		return
	}
	if platform.JSLength(platform.JSString(p256dh)) > 255 || platform.JSLength(platform.JSString(auth)) > 255 {
		platform.Error(w, 400, "Clés invalides")
		return
	}
	ua := nullable(userAgent)
	existing, err := h.db.Rows(ctx, "SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", uid(r), endpoint)
	if err != nil {
		pushFail(w, "POST /push/subscribe error:", err)
		return
	}
	if len(existing) > 0 {
		_, err = h.db.Exec(ctx, "UPDATE push_subscriptions SET p256dh = ?, auth = ?, user_agent = ? WHERE id = ?",
			platform.SQLParam(p256dh), platform.SQLParam(auth), ua, existing[0].Get("id"))
	} else {
		_, err = h.db.Exec(ctx, "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
			newID(), uid(r), endpoint, platform.SQLParam(p256dh), platform.SQLParam(auth), ua)
	}
	if err != nil {
		pushFail(w, "POST /push/subscribe error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiPushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	endpoint := field(r, "endpoint")
	if !platform.Truthy(endpoint) {
		platform.Error(w, 400, "endpoint requis")
		return
	}
	if _, err := h.db.Exec(r.Context(), "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", uid(r), platform.SQLParam(endpoint)); err != nil {
		pushFail(w, "DELETE /push/subscribe error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiPushSubscriptions(w http.ResponseWriter, r *http.Request) {
	if !h.auth.IsInternal(r) {
		platform.Error(w, 403, "Accès refusé")
		return
	}
	rows, err := h.db.Rows(r.Context(), "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?", r.PathValue("userId"))
	if err != nil {
		pushFail(w, "GET /push/subscriptions/:userId error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("subscriptions", rowsAny(rows)))
}

func (h *handlers) apiPushExpoSubscribe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token, ok := field(r, "token").(string)
	if !ok || token == "" || !expoTokenRe.MatchString(token) {
		platform.Error(w, 400, "token Expo Push valide requis")
		return
	}
	ua := nullable(field(r, "userAgent"))
	existing, err := h.db.Rows(ctx, "SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", uid(r), token)
	if err != nil {
		pushFail(w, "POST /push/expo-subscribe error:", err)
		return
	}
	if len(existing) > 0 {
		_, err = h.db.Exec(ctx, "UPDATE push_subscriptions SET user_agent = ? WHERE id = ?", ua, existing[0].Get("id"))
	} else {
		_, err = h.db.Exec(ctx, "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, NULL, NULL, ?)",
			newID(), uid(r), token, ua)
	}
	if err != nil {
		pushFail(w, "POST /push/expo-subscribe error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func vapidConfigured() (pub, priv string, ok bool) {
	pub, priv = platform.Env("VAPID_PUBLIC_KEY", ""), platform.Env("VAPID_PRIVATE_KEY", "")
	return pub, priv, pub != "" && priv != ""
}

func (h *handlers) apiPushSend(w http.ResponseWriter, r *http.Request) {
	if !h.auth.IsInternal(r) {
		platform.Error(w, 403, "Accès refusé")
		return
	}
	ctx := r.Context()
	userID := field(r, "userId")
	if !platform.Truthy(userID) {
		platform.Error(w, 400, "userId requis")
		return
	}
	str0 := func(k string, def string) string {
		if v := field(r, k); platform.Truthy(v) {
			return platform.JSString(v)
		}
		return def
	}
	title, body, link, typ, convKey := str0("title", "AlfyChat"), str0("body", ""), str0("url", "/"), str0("type", "message"), str0("conversationKey", "")

	rows, err := h.db.Rows(ctx, "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?", platform.SQLParam(userID))
	if err != nil {
		pushFail(w, "POST /push/send error:", err)
		return
	}
	if len(rows) == 0 {
		platform.JSON(w, 200, platform.O("sent", 0))
		return
	}
	var expoRows, vapidRows []platform.Row
	for _, s := range rows {
		if strings.HasPrefix(s.Str("endpoint"), "ExponentPushToken[") {
			expoRows = append(expoRows, s)
		} else {
			vapidRows = append(vapidRows, s)
		}
	}

	var (
		mu        sync.Mutex
		wg        sync.WaitGroup
		fulfilled int
	)
	done := func(ok bool) {
		mu.Lock()
		if ok {
			fulfilled++
		}
		mu.Unlock()
	}

	if len(expoRows) > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.sendExpo(ctx, expoRows, title, body, link, typ, convKey)
			done(true) // la promesse d'origine capture toute erreur : elle est toujours « remplie »
		}()
	}

	pub, priv, vapidOK := vapidConfigured()
	if len(vapidRows) > 0 && !vapidOK {
		slog.Warn(fmt.Sprintf("[push/send] VAPID non configuré — skip %d subscription(s) VAPID", len(vapidRows)))
	}
	if vapidOK {
		payload := platform.JSONString(platform.O("title", title, "body", body, "url", link, "type", typ, "conversationKey", convKey))
		for _, sub := range vapidRows {
			if !platform.Truthy(sub.Get("p256dh")) || !platform.Truthy(sub.Get("auth")) {
				continue
			}
			sub := sub
			wg.Add(1)
			go func() {
				defer wg.Done()
				res, err := webpush.SendNotificationWithContext(ctx, []byte(payload), &webpush.Subscription{
					Endpoint: sub.Str("endpoint"),
					Keys:     webpush.Keys{P256dh: sub.Str("p256dh"), Auth: sub.Str("auth")},
				}, &webpush.Options{
					Subscriber:      platform.Env("VAPID_SUBJECT", "mailto:no-reply@alfycore.org"),
					VAPIDPublicKey:  pub,
					VAPIDPrivateKey: priv,
					TTL:             2419200,
				})
				if err != nil {
					done(false)
					return
				}
				defer res.Body.Close()
				_, _ = io.Copy(io.Discard, res.Body)
				if res.StatusCode == 404 || res.StatusCode == 410 {
					_, _ = h.db.Exec(context.Background(), "DELETE FROM push_subscriptions WHERE endpoint = ?", sub.Get("endpoint"))
				}
				done(res.StatusCode >= 200 && res.StatusCode < 300)
			}()
		}
	}
	wg.Wait()
	platform.JSON(w, 200, platform.O("sent", fulfilled, "total", len(rows)))
}

// sendExpo envoie les notifications Expo et purge les jetons invalides ; les erreurs sont absorbées.
func (h *handlers) sendExpo(ctx context.Context, rows []platform.Row, title, body, link, typ, convKey string) {
	priority := "default"
	if typ == "mention" {
		priority = "high"
	}
	msgs := make([]any, len(rows))
	for i, s := range rows {
		msgs[i] = platform.O("to", s.Get("endpoint"), "title", title, "body", body,
			"data", platform.O("url", link, "type", typ, "conversationKey", convKey), "sound", "default", "priority", priority, "channelId", "default")
	}
	payload := platform.JSONString(msgs)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://exp.host/--/api/v2/push/send", bytes.NewReader([]byte(payload)))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return
	}
	raw, _ := io.ReadAll(res.Body)
	parsed, err := platform.ParseJSON(raw)
	if err != nil {
		return
	}
	data, _ := platform.GetPath(parsed, "data").([]any)
	for i, s := range rows {
		if i < len(data) && platform.GetPath(data[i], "details.error") == "DeviceNotRegistered" {
			_, _ = h.db.Exec(context.Background(), "DELETE FROM push_subscriptions WHERE endpoint = ?", s.Get("endpoint"))
		}
	}
}
