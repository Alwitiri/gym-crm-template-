-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'FROZEN', 'CANCELLED', 'PROSPECT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'SCHEDULED', 'ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WALK_IN', 'WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE_ADS', 'WHATSAPP', 'REFERRAL', 'PHONE_CALL', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'TRIAL_SCHEDULED', 'TRIAL_COMPLETED', 'FOLLOW_UP', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('NOTE', 'CALL', 'WHATSAPP', 'SMS', 'EMAIL', 'VISIT', 'STAGE_CHANGE', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "TrialStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('QR', 'MEMBER_CODE', 'PHONE_LOOKUP', 'RFID', 'BIOMETRIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "AttendanceResult" AS ENUM ('ALLOWED', 'DENIED');

-- CreateEnum
CREATE TYPE "AttendanceDenyReason" AS ENUM ('NOT_FOUND', 'NO_ACTIVE_SUBSCRIPTION', 'SUBSCRIPTION_FROZEN', 'BRANCH_NOT_ALLOWED', 'OUTSIDE_ACCESS_HOURS', 'ALREADY_CHECKED_IN', 'RESTRICTION_FLAG', 'DEVICE_NOT_TRUSTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceItemType" AS ENUM ('MEMBERSHIP', 'REGISTRATION_FEE', 'PT_PACKAGE', 'PRODUCT', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'GATEWAY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "GatewayOrderStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PtSessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED_BY_MEMBER', 'CANCELLED_BY_TRAINER', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "EquipmentCondition" AS ENUM ('GOOD', 'NEEDS_SERVICE', 'UNDER_REPAIR', 'OUT_OF_ORDER', 'RETIRED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'SALE', 'ADJUSTMENT', 'RETURN', 'WRITE_OFF', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_NOTICE', 'EXITED');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PAID');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED_NO_CONSENT');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('PRIVACY_NOTICE', 'HEALTH_DATA_PROCESSING', 'MARKETING_WHATSAPP', 'MARKETING_SMS', 'MARKETING_EMAIL', 'PHOTO_USE');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuthFactorType" AS ENUM ('TOTP');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'PASSWORD_RESET', 'PHONE_VERIFY');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('ACCESS', 'CORRECTION', 'ERASURE', 'CONSENT_WITHDRAWAL', 'GRIEVANCE');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "Business" (
    "id" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "gstin" VARCHAR(15),
    "pan" VARCHAR(10),
    "stateCode" VARCHAR(2) NOT NULL,
    "logoFileId" UUID,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "fyStartMonth" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,
    "pincode" VARCHAR(6) NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "gstin" VARCHAR(15),
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchHours" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "opensAt" VARCHAR(5) NOT NULL,
    "closesAt" VARCHAR(5) NOT NULL,

    CONSTRAINT "BranchHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchClosure" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "extendSubscriptions" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchSetting" (
    "id" UUID NOT NULL,
    "branchId" UUID,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "BranchSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" VARCHAR(15),
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ,
    "lastLoginAt" TIMESTAMPTZ,
    "passwordChangedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "branchId" UUID,
    "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" UUID,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "csrfSecretHash" VARCHAR(64) NOT NULL,
    "ipAddress" INET,
    "userAgent" TEXT,
    "deviceLabel" TEXT,
    "mfaVerifiedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "revokeReason" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthFactor" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "AuthFactorType" NOT NULL,
    "secretEncrypted" BYTEA NOT NULL,
    "confirmedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "phone" VARCHAR(15) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" VARCHAR(100) NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "memberCode" VARCHAR(20) NOT NULL,
    "homeBranchId" UUID NOT NULL,
    "userId" UUID,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "phone" VARCHAR(15) NOT NULL,
    "email" TEXT,
    "dateOfBirth" DATE,
    "gender" "Gender",
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "pincode" VARCHAR(6),
    "emergencyName" TEXT,
    "emergencyPhone" VARCHAR(15),
    "emergencyRelation" TEXT,
    "photoFileId" UUID,
    "qrToken" VARCHAR(64) NOT NULL,
    "rfidTag" TEXT,
    "status" "MemberStatus" NOT NULL DEFAULT 'PROSPECT',
    "hasAccessRestriction" BOOLEAN NOT NULL DEFAULT false,
    "restrictionNote" TEXT,
    "joinedOn" DATE NOT NULL,
    "convertedFromLeadId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberBranchTransfer" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "fromBranchId" UUID NOT NULL,
    "toBranchId" UUID NOT NULL,
    "reason" TEXT,
    "transferredById" UUID NOT NULL,
    "transferredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberBranchTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthDeclaration" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "consentRecordId" UUID NOT NULL,
    "formVersion" TEXT NOT NULL,
    "hasMedicalCondition" BOOLEAN NOT NULL,
    "parqAnswersEncrypted" BYTEA NOT NULL,
    "conditionsEncrypted" BYTEA,
    "medicationsEncrypted" BYTEA,
    "doctorClearanceFileId" UUID,
    "declaredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ,

    CONSTRAINT "HealthDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthRecordAccess" (
    "id" UUID NOT NULL,
    "healthDeclarationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "accessedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthRecordAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "evidenceFileId" UUID,
    "recordedById" UUID,
    "ipAddress" INET,
    "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberDocument" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "docType" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "MemberDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberNote" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMetric" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "recordedById" UUID,
    "measuredOn" DATE NOT NULL,
    "weightGrams" INTEGER,
    "heightMm" INTEGER,
    "bodyFatBp" INTEGER,
    "chestMm" INTEGER,
    "waistMm" INTEGER,
    "hipMm" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationDays" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "registrationFeePaise" INTEGER NOT NULL DEFAULT 0,
    "taxRateBp" INTEGER NOT NULL DEFAULT 1800,
    "sacCode" VARCHAR(8) NOT NULL DEFAULT '999723',
    "maxDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "freezeAllowed" BOOLEAN NOT NULL DEFAULT false,
    "maxFreezeDays" INTEGER NOT NULL DEFAULT 0,
    "maxFreezeCount" INTEGER NOT NULL DEFAULT 0,
    "allBranchAccess" BOOLEAN NOT NULL DEFAULT false,
    "accessStartTime" VARCHAR(5),
    "accessEndTime" VARCHAR(5),
    "facilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPlanBranch" (
    "planId" UUID NOT NULL,
    "branchId" UUID NOT NULL,

    CONSTRAINT "MembershipPlanBranch_pkey" PRIMARY KEY ("planId","branchId")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "invoiceId" UUID,
    "previousSubscriptionId" UUID,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "originalEndDate" DATE NOT NULL,
    "planSnapshot" JSONB NOT NULL,
    "activatedAt" TIMESTAMPTZ,
    "cancelledAt" TIMESTAMPTZ,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionFreeze" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "approvedById" UUID NOT NULL,
    "endedEarlyOn" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionFreeze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionExtension" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "branchClosureId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "email" TEXT,
    "source" "LeadSource" NOT NULL,
    "sourceDetail" TEXT,
    "referredByMemberId" UUID,
    "interestedPlanId" UUID,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" UUID,
    "nextFollowUpAt" TIMESTAMPTZ,
    "lostReason" TEXT,
    "duplicateOfId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "convertedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "notes" TEXT,
    "fromStage" "LeadStage",
    "toStage" "LeadStage",
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trial" (
    "id" UUID NOT NULL,
    "leadId" UUID,
    "memberId" UUID,
    "scheduledAt" TIMESTAMPTZ NOT NULL,
    "trainerId" UUID,
    "status" "TrialStatus" NOT NULL DEFAULT 'SCHEDULED',
    "feedback" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "apiKeyHash" VARCHAR(64) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "memberId" UUID,
    "branchId" UUID NOT NULL,
    "deviceId" UUID,
    "operatorId" UUID,
    "subscriptionId" UUID,
    "method" "AttendanceMethod" NOT NULL,
    "result" "AttendanceResult" NOT NULL,
    "denyReason" "AttendanceDenyReason",
    "overrideReason" TEXT,
    "checkInAt" TIMESTAMPTZ NOT NULL,
    "checkOutAt" TIMESTAMPTZ,
    "clientEventId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "employeeCode" VARCHAR(20) NOT NULL,
    "branchId" UUID NOT NULL,
    "designation" TEXT NOT NULL,
    "isTrainer" BOOLEAN NOT NULL DEFAULT false,
    "specializations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joinedOn" DATE NOT NULL,
    "exitedOn" DATE,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "monthlySalaryPaise" INTEGER NOT NULL DEFAULT 0,
    "ptCommissionBp" INTEGER NOT NULL DEFAULT 0,
    "bankAccountEncrypted" BYTEA,
    "panEncrypted" BYTEA,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerAssignment" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ,
    "endReason" TEXT,

    CONSTRAINT "TrainerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerAvailability" (
    "id" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,

    CONSTRAINT "TrainerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffShift" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,

    CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAttendance" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "clockInAt" TIMESTAMPTZ,
    "clockOutAt" TIMESTAMPTZ,
    "status" TEXT NOT NULL,

    CONSTRAINT "StaffAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "leaveType" TEXT NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" UUID,
    "decidedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdvance" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "givenOn" DATE NOT NULL,
    "recoveredInPayslipId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "finalizedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "basePaise" INTEGER NOT NULL,
    "commissionPaise" INTEGER NOT NULL DEFAULT 0,
    "incentivePaise" INTEGER NOT NULL DEFAULT 0,
    "deductionsPaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "pdfFileId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "muscleGroup" TEXT NOT NULL,
    "equipment" TEXT,
    "instructions" TEXT,
    "videoUrl" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutPlan" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "WorkoutPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutPlanExercise" (
    "id" UUID NOT NULL,
    "workoutPlanId" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "dayOfWeek" INTEGER,
    "dayLabel" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" VARCHAR(20) NOT NULL,
    "weightKg" DECIMAL(6,2),
    "restSeconds" INTEGER,
    "notes" TEXT,

    CONSTRAINT "WorkoutPlanExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietPlan" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "dailyCalories" INTEGER,
    "proteinG" INTEGER,
    "carbsG" INTEGER,
    "fatG" INTEGER,
    "preferences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DietPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietMeal" (
    "id" UUID NOT NULL,
    "dietPlanId" UUID NOT NULL,
    "mealTime" VARCHAR(5) NOT NULL,
    "label" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "DietMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtPackage" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "taxRateBp" INTEGER NOT NULL DEFAULT 1800,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberPtPackage" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "ptPackageId" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "invoiceId" UUID,
    "sessionsTotal" INTEGER NOT NULL,
    "sessionsUsed" INTEGER NOT NULL DEFAULT 0,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberPtPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtSession" (
    "id" UUID NOT NULL,
    "memberPtPackageId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "trainerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "scheduledStart" TIMESTAMPTZ NOT NULL,
    "scheduledEnd" TIMESTAMPTZ NOT NULL,
    "status" "PtSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "countsAgainstPackage" BOOLEAN NOT NULL DEFAULT true,
    "trainerNotes" TEXT,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "branchId" UUID NOT NULL,
    "financialYear" VARCHAR(7) NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("branchId","financialYear")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "invoiceNumber" TEXT,
    "branchId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE,
    "dueDate" DATE,
    "placeOfSupplyStateCode" VARCHAR(2) NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "roundOffPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "couponId" UUID,
    "notes" TEXT,
    "pdfFileId" UUID,
    "createdById" UUID NOT NULL,
    "voidedAt" TIMESTAMPTZ,
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "itemType" "InvoiceItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "sacOrHsn" VARCHAR(8),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPricePaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "taxableValuePaise" INTEGER NOT NULL,
    "taxRateBp" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "productId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountPaise" INTEGER NOT NULL,
    "unallocatedPaise" INTEGER NOT NULL DEFAULT 0,
    "referenceNumber" TEXT,
    "gatewayOrderId" UUID,
    "gatewayPaymentId" TEXT,
    "receivedById" UUID,
    "receivedAt" TIMESTAMPTZ NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "method" "PaymentMethod" NOT NULL,
    "gatewayRefundId" TEXT,
    "creditNoteId" UUID,
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "processedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" UUID NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "invoiceId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL,
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayOrder" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "providerOrderId" TEXT NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "GatewayOrderStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "GatewayOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ,
    "processingError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "percentBp" INTEGER,
    "flatPaise" INTEGER,
    "maxDiscountPaise" INTEGER,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "appliesTo" "InvoiceItemType"[] DEFAULT ARRAY[]::"InvoiceItemType"[],
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "vendorId" UUID,
    "description" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL DEFAULT 0,
    "expenseDate" DATE NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "referenceNumber" TEXT,
    "receiptFileId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "gstin" VARCHAR(15),
    "address" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" UUID NOT NULL,
    "assetTag" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "brand" TEXT,
    "serialNumber" TEXT,
    "vendorId" UUID,
    "purchaseDate" DATE,
    "purchasePricePaise" INTEGER,
    "warrantyUntil" DATE,
    "serviceIntervalDays" INTEGER,
    "nextServiceDue" DATE,
    "condition" "EquipmentCondition" NOT NULL DEFAULT 'GOOD',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceLog" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "performedOn" DATE NOT NULL,
    "performedBy" TEXT,
    "loggedById" UUID NOT NULL,
    "conditionAfter" "EquipmentCondition" NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hsnCode" VARCHAR(8),
    "sellingPricePaise" INTEGER NOT NULL,
    "taxRateBp" INTEGER NOT NULL DEFAULT 1800,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostPaise" INTEGER,
    "vendorId" UUID,
    "invoiceItemId" UUID,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "providerTemplateName" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isMarketing" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" UUID NOT NULL,
    "templateId" UUID,
    "memberId" UUID,
    "recipientUserId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "payload" JSONB,
    "scheduledFor" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "details" TEXT,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'OPEN',
    "dueBy" TIMESTAMPTZ NOT NULL,
    "resolution" TEXT,
    "handledById" UUID,
    "resolvedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "branchId" UUID,
    "requestId" VARCHAR(64),
    "ipAddress" INET,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "result" "AuditResult" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BranchHours_branchId_dayOfWeek_opensAt_key" ON "BranchHours"("branchId", "dayOfWeek", "opensAt");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSetting_branchId_key_key" ON "BranchSetting"("branchId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "UserRole_branchId_idx" ON "UserRole"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_branchId_key" ON "UserRole"("userId", "roleId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_phone_purpose_createdAt_idx" ON "OtpChallenge"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Member_memberCode_key" ON "Member"("memberCode");

-- CreateIndex
CREATE UNIQUE INDEX "Member_userId_key" ON "Member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_qrToken_key" ON "Member"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "Member_rfidTag_key" ON "Member"("rfidTag");

-- CreateIndex
CREATE UNIQUE INDEX "Member_convertedFromLeadId_key" ON "Member"("convertedFromLeadId");

-- CreateIndex
CREATE INDEX "Member_phone_idx" ON "Member"("phone");

-- CreateIndex
CREATE INDEX "Member_homeBranchId_status_idx" ON "Member"("homeBranchId", "status");

-- CreateIndex
CREATE INDEX "Member_lastName_firstName_idx" ON "Member"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "MemberBranchTransfer_memberId_idx" ON "MemberBranchTransfer"("memberId");

-- CreateIndex
CREATE INDEX "HealthDeclaration_memberId_supersededAt_idx" ON "HealthDeclaration"("memberId", "supersededAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_memberId_purpose_recordedAt_idx" ON "ConsentRecord"("memberId", "purpose", "recordedAt");

-- CreateIndex
CREATE INDEX "BodyMetric_memberId_measuredOn_idx" ON "BodyMetric"("memberId", "measuredOn");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_invoiceId_key" ON "Subscription"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_previousSubscriptionId_key" ON "Subscription"("previousSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_memberId_status_idx" ON "Subscription"("memberId", "status");

-- CreateIndex
CREATE INDEX "Subscription_endDate_status_idx" ON "Subscription"("endDate", "status");

-- CreateIndex
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");

-- CreateIndex
CREATE INDEX "Lead_branchId_stage_idx" ON "Lead"("branchId", "stage");

-- CreateIndex
CREATE INDEX "Lead_assignedToId_nextFollowUpAt_idx" ON "Lead"("assignedToId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_occurredAt_idx" ON "LeadActivity"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "Trial_scheduledAt_idx" ON "Trial"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_apiKeyHash_key" ON "Device"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_clientEventId_key" ON "Attendance"("clientEventId");

-- CreateIndex
CREATE INDEX "Attendance_branchId_checkInAt_idx" ON "Attendance"("branchId", "checkInAt");

-- CreateIndex
CREATE INDEX "Attendance_memberId_checkInAt_idx" ON "Attendance"("memberId", "checkInAt");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_userId_key" ON "Staff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_employeeCode_key" ON "Staff"("employeeCode");

-- CreateIndex
CREATE INDEX "Staff_branchId_employmentStatus_idx" ON "Staff"("branchId", "employmentStatus");

-- CreateIndex
CREATE INDEX "TrainerAssignment_trainerId_endedAt_idx" ON "TrainerAssignment"("trainerId", "endedAt");

-- CreateIndex
CREATE INDEX "TrainerAssignment_memberId_endedAt_idx" ON "TrainerAssignment"("memberId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffShift_staffId_date_startTime_key" ON "StaffShift"("staffId", "date", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendance_staffId_date_key" ON "StaffAttendance"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_periodStart_periodEnd_key" ON "PayrollRun"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_payrollRunId_staffId_key" ON "Payslip"("payrollRunId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_name_key" ON "Exercise"("name");

-- CreateIndex
CREATE INDEX "WorkoutPlan_memberId_isActive_idx" ON "WorkoutPlan"("memberId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MemberPtPackage_invoiceId_key" ON "MemberPtPackage"("invoiceId");

-- CreateIndex
CREATE INDEX "PtSession_trainerId_scheduledStart_idx" ON "PtSession"("trainerId", "scheduledStart");

-- CreateIndex
CREATE INDEX "PtSession_memberId_scheduledStart_idx" ON "PtSession"("memberId", "scheduledStart");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_memberId_status_idx" ON "Invoice"("memberId", "status");

-- CreateIndex
CREATE INDEX "Invoice_branchId_issueDate_idx" ON "Invoice"("branchId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_gatewayPaymentId_key" ON "Payment"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "Payment_memberId_receivedAt_idx" ON "Payment"("memberId", "receivedAt");

-- CreateIndex
CREATE INDEX "Payment_branchId_receivedAt_method_idx" ON "Payment"("branchId", "receivedAt", "method");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_gatewayRefundId_key" ON "Refund"("gatewayRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_creditNoteId_key" ON "Refund"("creditNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_noteNumber_key" ON "CreditNote"("noteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayOrder_providerOrderId_key" ON "GatewayOrder"("providerOrderId");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key" ON "WebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE INDEX "Expense_branchId_expenseDate_idx" ON "Expense"("branchId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_assetTag_key" ON "Equipment"("assetTag");

-- CreateIndex
CREATE INDEX "Equipment_branchId_nextServiceDue_idx" ON "Equipment"("branchId", "nextServiceDue");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "StockMovement_productId_branchId_idx" ON "StockMovement"("productId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_key_channel_language_key" ON "NotificationTemplate"("key", "channel", "language");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationLog_status_scheduledFor_idx" ON "NotificationLog"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "NotificationLog_memberId_createdAt_idx" ON "NotificationLog"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_status_dueBy_idx" ON "DataSubjectRequest"("status", "dueBy");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_memberId_idx" ON "DataSubjectRequest"("memberId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_occurredAt_idx" ON "AuditLog"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_occurredAt_idx" ON "AuditLog"("action", "occurredAt");

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchHours" ADD CONSTRAINT "BranchHours_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchClosure" ADD CONSTRAINT "BranchClosure_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchClosure" ADD CONSTRAINT "BranchClosure_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchSetting" ADD CONSTRAINT "BranchSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchSetting" ADD CONSTRAINT "BranchSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthFactor" ADD CONSTRAINT "AuthFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_homeBranchId_fkey" FOREIGN KEY ("homeBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_photoFileId_fkey" FOREIGN KEY ("photoFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_convertedFromLeadId_fkey" FOREIGN KEY ("convertedFromLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBranchTransfer" ADD CONSTRAINT "MemberBranchTransfer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBranchTransfer" ADD CONSTRAINT "MemberBranchTransfer_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBranchTransfer" ADD CONSTRAINT "MemberBranchTransfer_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBranchTransfer" ADD CONSTRAINT "MemberBranchTransfer_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthDeclaration" ADD CONSTRAINT "HealthDeclaration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthDeclaration" ADD CONSTRAINT "HealthDeclaration_consentRecordId_fkey" FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecordAccess" ADD CONSTRAINT "HealthRecordAccess_healthDeclarationId_fkey" FOREIGN KEY ("healthDeclarationId") REFERENCES "HealthDeclaration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecordAccess" ADD CONSTRAINT "HealthRecordAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberDocument" ADD CONSTRAINT "MemberDocument_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberDocument" ADD CONSTRAINT "MemberDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberNote" ADD CONSTRAINT "MemberNote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberNote" ADD CONSTRAINT "MemberNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMetric" ADD CONSTRAINT "BodyMetric_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPlanBranch" ADD CONSTRAINT "MembershipPlanBranch_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPlanBranch" ADD CONSTRAINT "MembershipPlanBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_previousSubscriptionId_fkey" FOREIGN KEY ("previousSubscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionFreeze" ADD CONSTRAINT "SubscriptionFreeze_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionFreeze" ADD CONSTRAINT "SubscriptionFreeze_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionExtension" ADD CONSTRAINT "SubscriptionExtension_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_referredByMemberId_fkey" FOREIGN KEY ("referredByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_interestedPlanId_fkey" FOREIGN KEY ("interestedPlanId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trial" ADD CONSTRAINT "Trial_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trial" ADD CONSTRAINT "Trial_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trial" ADD CONSTRAINT "Trial_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerAssignment" ADD CONSTRAINT "TrainerAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerAssignment" ADD CONSTRAINT "TrainerAssignment_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerAvailability" ADD CONSTRAINT "TrainerAvailability_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlanExercise" ADD CONSTRAINT "WorkoutPlanExercise_workoutPlanId_fkey" FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlanExercise" ADD CONSTRAINT "WorkoutPlanExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietPlan" ADD CONSTRAINT "DietPlan_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietPlan" ADD CONSTRAINT "DietPlan_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietMeal" ADD CONSTRAINT "DietMeal_dietPlanId_fkey" FOREIGN KEY ("dietPlanId") REFERENCES "DietPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPtPackage" ADD CONSTRAINT "MemberPtPackage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPtPackage" ADD CONSTRAINT "MemberPtPackage_ptPackageId_fkey" FOREIGN KEY ("ptPackageId") REFERENCES "PtPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPtPackage" ADD CONSTRAINT "MemberPtPackage_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPtPackage" ADD CONSTRAINT "MemberPtPackage_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtSession" ADD CONSTRAINT "PtSession_memberPtPackageId_fkey" FOREIGN KEY ("memberPtPackageId") REFERENCES "MemberPtPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtSession" ADD CONSTRAINT "PtSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtSession" ADD CONSTRAINT "PtSession_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtSession" ADD CONSTRAINT "PtSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_gatewayOrderId_fkey" FOREIGN KEY ("gatewayOrderId") REFERENCES "GatewayOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayOrder" ADD CONSTRAINT "GatewayOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceLog" ADD CONSTRAINT "MaintenanceLog_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
