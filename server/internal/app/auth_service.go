package app

import (
	"context"
	"errors"

	"golang.org/x/crypto/bcrypt"
)

type authService struct {
	store accountStore
}

func newAuthService(store accountStore) *authService {
	return &authService{store: store}
}

func (s *authService) Register(ctx context.Context, email, username, password, confirmPassword string) (Account, error) {
	if err := validateRegistration(email, username, password, confirmPassword); err != nil {
		return Account{}, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return Account{}, err
	}

	return s.store.CreateAccount(ctx, email, username, string(hash))
}

func (s *authService) Login(ctx context.Context, email, password string) (Account, error) {
	if normalizeEmail(email) == "" || password == "" {
		return Account{}, ErrAuthenticationFailed
	}

	account, err := s.store.FindAccountByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			return Account{}, ErrAuthenticationFailed
		}
		return Account{}, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(password)); err != nil {
		return Account{}, ErrAuthenticationFailed
	}

	return account, nil
}
