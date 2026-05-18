import { pgTable, varchar, timestamp, text, integer, uniqueIndex, foreignKey, boolean, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const userRole = pgEnum("UserRole", ['USER', 'ADMIN'])
export const verificationType = pgEnum("VerificationType", ['DNS', 'FILE'])

export const domains = pgTable("domains", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	verified: boolean().default(false).notNull(),
	verificationCode: text("verification_code").notNull(),
	createdAt: timestamp("created_at").$defaultFn(() => /* @__PURE__ */ new Date()).notNull(),
	updatedAt: timestamp("updated_at").$defaultFn(() => /* @__PURE__ */ new Date()).notNull(),
	userId: text("user_id").notNull(),
	verificationType: verificationType("verification_type").default('DNS').notNull(),
}, (table) => [
	uniqueIndex("domain_name_key").using("btree", table.name.asc().nullsLast().op("text_ops")),
	uniqueIndex("domain_verification_code_key").using("btree", table.verificationCode.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "domain_user_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
email: text('email').notNull().unique(),
emailVerified: boolean('email_verified').$defaultFn(() => false).notNull(),
image: text('image'),
createdAt: timestamp('created_at').$defaultFn(() => /* @__PURE__ */ new Date()).notNull(),
updatedAt: timestamp('updated_at').$defaultFn(() => /* @__PURE__ */ new Date()).notNull(),
role: text('role'),
banned: boolean('banned'),
banReason: text('ban_reason'),
banExpires: timestamp('ban_expires')
});

export const sessions = pgTable("sessions", {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at').notNull(),
token: text('token').notNull().unique(),
createdAt: timestamp('created_at').notNull(),
updatedAt: timestamp('updated_at').notNull(),
ipAddress: text('ip_address'),
userAgent: text('user_agent'),
userId: text('user_id').notNull().references(()=> users.id, { onDelete: 'cascade' }),
impersonatedBy: text('impersonated_by')
});

export const accounts = pgTable("accounts", {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
providerId: text('provider_id').notNull(),
userId: text('user_id').notNull().references(()=> users.id, { onDelete: 'cascade' }),
accessToken: text('access_token'),
refreshToken: text('refresh_token'),
idToken: text('id_token'),
accessTokenExpiresAt: timestamp('access_token_expires_at'),
refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
scope: text('scope'),
password: text('password'),
createdAt: timestamp('created_at').notNull(),
updatedAt: timestamp('updated_at').notNull()
});

export const verifications = pgTable("verifications", {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
value: text('value').notNull(),
expiresAt: timestamp('expires_at').notNull(),
createdAt: timestamp('created_at').$defaultFn(() => /* @__PURE__ */ new Date()),
updatedAt: timestamp('updated_at').$defaultFn(() => /* @__PURE__ */ new Date())
});

// 长期存储：按日期的全站统计
export const dailyStats = pgTable("daily_stats", {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	domain: varchar('domain', { length: 255 }).notNull(),
	date: text('date').notNull(), // YYYY-MM-DD 格式
	sitePv: integer('site_pv').default(0).notNull(),
	siteUv: integer('site_uv').default(0).notNull(),
	createdAt: timestamp('created_at').$defaultFn(() => new Date()).notNull(),
	updatedAt: timestamp('updated_at').$defaultFn(() => new Date()).notNull(),
},
(table) => [
	uniqueIndex("idx_daily_stats_unique").using("btree", table.domain.asc(), table.date.asc()),
]);

// 长期存储：按日期的页面级统计
export const pageStats = pgTable("page_stats", {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	domain: varchar('domain', { length: 255 }).notNull(),
	pagePath: text('page_path').notNull(),
	date: text('date').notNull(), // YYYY-MM-DD 格式
	pv: integer('pv').default(0).notNull(),
	uv: integer('uv').default(0).notNull(),
	createdAt: timestamp('created_at').$defaultFn(() => new Date()).notNull(),
	updatedAt: timestamp('updated_at').$defaultFn(() => new Date()).notNull(),
},
(table) => [
	uniqueIndex("idx_page_stats_unique").using("btree", table.domain.asc(), table.pagePath.asc(), table.date.asc()),
]);
