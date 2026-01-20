'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterSchema } from '@project/shared/schema';
import type { RegisterData } from '@project/shared/schema';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  parseAuthError,
  getFieldError,
  getToastMessage,
} from '@project/shared';

interface SignupFormProps {
  onSuccess?: () => void;
  redirectTo?: string;
}

// Password strength calculation
const calculatePasswordStrength = (password: string): number => {
  let strength = 0;
  if (password.length >= 8) strength += 25;
  if (password.match(/[a-z]/)) strength += 25;
  if (password.match(/[A-Z]/)) strength += 25;
  if (password.match(/[0-9]/)) strength += 12.5;
  if (password.match(/[^a-zA-Z0-9]/)) strength += 12.5;
  return Math.min(strength, 100);
};

const getPasswordStrengthLabel = (strength: number): string => {
  if (strength < 25) return 'Very Weak';
  if (strength < 50) return 'Weak';
  if (strength < 75) return 'Good';
  return 'Strong';
};

const getPasswordStrengthColor = (strength: number): string => {
  if (strength < 25) return 'bg-red-500';
  if (strength < 50) return 'bg-orange-500';
  if (strength < 75) return 'bg-yellow-500';
  return 'bg-green-500';
};

export function SignupForm({ onSuccess, redirectTo }: SignupFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { signup } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setError,
  } = useForm<RegisterData>({
    resolver: zodResolver(RegisterSchema),
    mode: 'onChange', // Enable real-time validation
  });

  const watchedPassword = watch('password', '');
  const passwordStrength = calculatePasswordStrength(watchedPassword);

  const onSubmit = async (data: RegisterData) => {
    setIsLoading(true);
    try {
      await signup({
        email: data.email,
        password: data.password,
        passwordConfirm: data.passwordConfirm,
        name: data.name,
      });

      toast.success('Account created successfully! You are now logged in.');

      if (onSuccess) {
        onSuccess();
      } else if (redirectTo) {
        window.location.href = redirectTo;
      } else {
        window.location.href = '/';
      }
    } catch (error: unknown) {
      console.error('Signup failed:', error);

      const parsedError = parseAuthError(error);

      // Set field-specific errors
      const emailError = getFieldError(error, 'email');
      const passwordError = getFieldError(error, 'password');
      const passwordConfirmError = getFieldError(error, 'passwordConfirm');
      const nameError = getFieldError(error, 'name');

      if (emailError) {
        setError('email', { type: 'manual', message: emailError });
      }
      if (passwordError) {
        setError('password', { type: 'manual', message: passwordError });
      }
      if (passwordConfirmError) {
        setError('passwordConfirm', {
          type: 'manual',
          message: passwordConfirmError,
        });
      }
      if (nameError) {
        setError('name', { type: 'manual', message: nameError });
      }

      // Set general error if no field-specific errors
      if (
        !emailError &&
        !passwordError &&
        !passwordConfirmError &&
        !nameError
      ) {
        setError('root', {
          type: 'manual',
          message: parsedError.message,
        });
      }

      // Show toast with appropriate message
      const toastMessage = getToastMessage(error, 'Registration');
      toast.error(toastMessage.title, {
        description: toastMessage.description,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name (Optional)</Label>
          <Input
            id="name"
            type="text"
            {...register('name')}
            placeholder="Enter your full name"
            disabled={isLoading}
          />
          {errors.name && (
            <p className="text-sm text-red-600">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            {...register('email')}
            placeholder="Enter your email"
            disabled={isLoading}
          />
          {errors.email && (
            <p className="text-sm text-red-600">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            {...register('password')}
            placeholder="Enter your password"
            disabled={isLoading}
          />
          {errors.password && (
            <p className="text-sm text-red-600">{errors.password.message}</p>
          )}

          {/* Password strength indicator */}
          {watchedPassword && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>Password strength:</span>
                <span
                  className={`font-medium ${
                    passwordStrength < 50
                      ? 'text-red-600'
                      : passwordStrength < 75
                        ? 'text-yellow-600'
                        : 'text-green-600'
                  }`}
                >
                  {getPasswordStrengthLabel(passwordStrength)}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${getPasswordStrengthColor(passwordStrength)}`}
                  style={{ width: `${passwordStrength}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="passwordConfirm">Confirm Password</Label>
          <Input
            id="passwordConfirm"
            type="password"
            {...register('passwordConfirm')}
            placeholder="Confirm your password"
            disabled={isLoading}
          />
          {errors.passwordConfirm && (
            <p className="text-sm text-red-600">
              {errors.passwordConfirm.message}
            </p>
          )}
        </div>

        {errors.root && (
          <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
            {errors.root.message}
          </div>
        )}

        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <div className="text-center">
        <p className="text-sm text-gray-600">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-blue-600 hover:text-blue-500"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
