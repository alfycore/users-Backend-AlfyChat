package users

import (
	"encoding/json"
	"os"
	"testing"
)

type filterCase struct {
	N string `json:"n"`
	R struct {
		Ok     bool   `json:"ok"`
		Reason string `json:"reason"`
		Term   string `json:"term"`
	} `json:"r"`
}

// Les cas viennent du vrai username-filter.ts exécuté sous Node.
func TestUsernameFilterAgainstJS(t *testing.T) {
	raw, err := os.ReadFile("testdata/filter.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Res, Res2, Res3 []filterCase
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	check := func(cases []filterCase, allow bool) {
		for _, c := range cases {
			got := checkUsername(c.N, allow)
			if got.ok != c.R.Ok || got.reason != c.R.Reason || got.term != c.R.Term {
				t.Errorf("%q (allowReserved=%v): got %+v, want %+v", c.N, allow, got, c.R)
			}
		}
	}
	check(fx.Res, false)
	check(fx.Res2, true)
	setCustomTerms([]customTerm{{"Banane", matchWord}, {"foo bar", matchSubstring}, {"Exact1", matchExact}})
	defer setCustomTerms(nil)
	check(fx.Res3, false)
}
