// Test-only host-module double: no product classes or variant recipes.
// Radix keeps the real dialog interaction; the host owns its appearance.
import * as React from "react";
import { AlertDialog as Primitive, Slot } from "radix-ui";

type ButtonProps = React.ComponentProps<"button"> & { asChild?: boolean; variant?: string; size?: string };
export function Button({ asChild, variant: _variant, size: _size, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return <Component data-slot="button" {...props} />;
}

export const AlertDialog = Primitive.Root;
export function AlertDialogTrigger(props: React.ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}
export const AlertDialogTitle = Primitive.Title;
export const AlertDialogDescription = Primitive.Description;
export const AlertDialogAction = Primitive.Action;
export const AlertDialogCancel = Primitive.Cancel;

export function AlertDialogContent(props: React.ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Overlay /><Primitive.Content data-slot="alert-dialog-content" {...props} /></Primitive.Portal>;
}

export function AlertDialogHeader(props: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-header" {...props} />;
}

export function AlertDialogFooter(props: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" {...props} />;
}
