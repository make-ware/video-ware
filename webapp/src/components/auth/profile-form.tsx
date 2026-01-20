'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  parseAuthError,
  getFieldError,
  getToastMessage,
} from '@project/shared';

// Schema for profile updates (name and email only)
const ProfileUpdateSchema = z.object({
  name: z.string().max(255, 'Name must be less than 255 characters').optional(),
  email: z.string().email('Invalid email address'),
});

// Schema for password change
const PasswordChangeSchema = z
  .object({
    oldPassword: z.string().min(1, 'Current password is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords don't match",
    path: ['passwordConfirm'],
  });

type ProfileUpdateData = z.infer<typeof ProfileUpdateSchema>;
type PasswordChangeData = z.infer<typeof PasswordChangeSchema>;

export function ProfileForm() {
  const { user, updateProfile, changePassword } = useAuth();
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Profile update form
  const profileForm = useForm<ProfileUpdateData>({
    resolver: zodResolver(ProfileUpdateSchema),
    defaultValues: {
      name: user?.name || '',
      email: user?.email || '',
    },
  });

  // Password change form
  const passwordForm = useForm<PasswordChangeData>({
    resolver: zodResolver(PasswordChangeSchema),
  });

  const onProfileSubmit = async (data: ProfileUpdateData) => {
    setIsUpdatingProfile(true);
    try {
      await updateProfile(data);
      toast.success('Profile updated successfully!');
    } catch (error: unknown) {
      console.error('Profile update failed:', error);

      const parsedError = parseAuthError(error);

      // Set field-specific errors
      const emailError = getFieldError(error, 'email');
      const nameError = getFieldError(error, 'name');

      if (emailError) {
        profileForm.setError('email', { type: 'manual', message: emailError });
      }
      if (nameError) {
        profileForm.setError('name', { type: 'manual', message: nameError });
      }

      // Set general error if no field-specific errors
      if (!emailError && !nameError) {
        profileForm.setError('root', {
          type: 'manual',
          message: parsedError.message,
        });
      }

      // Show toast with appropriate message
      const toastMessage = getToastMessage(error, 'Profile update');
      toast.error(toastMessage.title, {
        description: toastMessage.description,
      });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const onPasswordSubmit = async (data: PasswordChangeData) => {
    setIsChangingPassword(true);
    try {
      await changePassword(
        data.oldPassword,
        data.password,
        data.passwordConfirm
      );
      toast.success('Password changed successfully!');
      passwordForm.reset();
    } catch (error: unknown) {
      console.error('Password change failed:', error);

      const parsedError = parseAuthError(error);

      // Set field-specific errors
      const oldPasswordError = getFieldError(error, 'oldPassword');
      const passwordError = getFieldError(error, 'password');

      if (
        oldPasswordError ||
        parsedError.message.includes('old password') ||
        parsedError.message.includes('current password')
      ) {
        passwordForm.setError('oldPassword', {
          type: 'manual',
          message: 'Current password is incorrect.',
        });
      } else if (passwordError) {
        passwordForm.setError('password', {
          type: 'manual',
          message: passwordError,
        });
      } else {
        passwordForm.setError('root', {
          type: 'manual',
          message: parsedError.message,
        });
      }

      // Show toast with appropriate message
      const toastMessage = getToastMessage(error, 'Password change');
      toast.error(toastMessage.title, {
        description: toastMessage.description,
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (!user) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-gray-600">
            Please log in to view your profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Information Card */}
      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
          <CardDescription>
            Update your personal information and email address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={profileForm.handleSubmit(onProfileSubmit)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                {...profileForm.register('name')}
                placeholder="Enter your name"
                disabled={isUpdatingProfile}
              />
              {profileForm.formState.errors.name && (
                <p className="text-sm text-red-600">
                  {profileForm.formState.errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                {...profileForm.register('email')}
                placeholder="Enter your email"
                disabled={isUpdatingProfile}
              />
              {profileForm.formState.errors.email && (
                <p className="text-sm text-red-600">
                  {profileForm.formState.errors.email.message}
                </p>
              )}
            </div>

            {profileForm.formState.errors.root && (
              <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
                {profileForm.formState.errors.root.message}
              </div>
            )}

            <Button type="submit" disabled={isUpdatingProfile}>
              {isUpdatingProfile ? 'Updating...' : 'Update Profile'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Separator />

      {/* Password Change Card */}
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            Update your password to keep your account secure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="oldPassword">Current Password</Label>
              <Input
                id="oldPassword"
                type="password"
                {...passwordForm.register('oldPassword')}
                placeholder="Enter your current password"
                disabled={isChangingPassword}
              />
              {passwordForm.formState.errors.oldPassword && (
                <p className="text-sm text-red-600">
                  {passwordForm.formState.errors.oldPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                {...passwordForm.register('password')}
                placeholder="Enter your new password"
                disabled={isChangingPassword}
              />
              {passwordForm.formState.errors.password && (
                <p className="text-sm text-red-600">
                  {passwordForm.formState.errors.password.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="passwordConfirm">Confirm New Password</Label>
              <Input
                id="passwordConfirm"
                type="password"
                {...passwordForm.register('passwordConfirm')}
                placeholder="Confirm your new password"
                disabled={isChangingPassword}
              />
              {passwordForm.formState.errors.passwordConfirm && (
                <p className="text-sm text-red-600">
                  {passwordForm.formState.errors.passwordConfirm.message}
                </p>
              )}
            </div>

            {passwordForm.formState.errors.root && (
              <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
                {passwordForm.formState.errors.root.message}
              </div>
            )}

            <Button type="submit" disabled={isChangingPassword}>
              {isChangingPassword ? 'Changing Password...' : 'Change Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
