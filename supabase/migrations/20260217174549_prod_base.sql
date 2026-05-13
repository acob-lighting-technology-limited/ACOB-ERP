


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."employment_status" AS ENUM (
    'active',
    'suspended',
    'terminated',
    'on_leave'
);


ALTER TYPE "public"."employment_status" OWNER TO "postgres";


CREATE TYPE "public"."gateway_status" AS ENUM (
    'online',
    'offline',
    'maintenance'
);


ALTER TYPE "public"."gateway_status" OWNER TO "postgres";


CREATE TYPE "public"."task_priority" AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


ALTER TYPE "public"."task_priority" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'visitor',
    'employee',
    'lead',
    'admin',
    'super_admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  previous_assigned_to uuid;
BEGIN
  -- Lock any current assignments for this asset
  SELECT assigned_to
  INTO previous_assigned_to
  FROM asset_assignments
  WHERE asset_id = p_asset_id AND is_current = true
  ORDER BY assigned_at DESC
  LIMIT 1
  FOR UPDATE;

  -- Mark all existing assignments as not current
  UPDATE asset_assignments
  SET
    is_current = false,
    handed_over_at = NOW(),
    handover_notes = 'Reassigned via assign_asset()'
  WHERE asset_id = p_asset_id AND is_current = true;

  -- Insert the new assignment
  INSERT INTO asset_assignments (
    asset_id,
    assigned_to,
    assigned_from,
    assigned_by,
    assignment_notes,
    is_current
  )
  VALUES (
    p_asset_id,
    p_assigned_to,
    previous_assigned_to,
    p_assigned_by,
    p_assignment_notes,
    true
  );

  -- Ensure asset status is marked as assigned
  UPDATE assets
  SET status = 'assigned'
  WHERE id = p_asset_id;

  RETURN previous_assigned_to;
END;
$$;


ALTER FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assignment_type" "text", "p_assigned_by" "uuid", "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_assignment_id UUID;
  v_asset_number TEXT;
  v_asset_name TEXT;
BEGIN
  -- Get asset details
  SELECT asset_number, asset_name INTO v_asset_number, v_asset_name
  FROM assets
  WHERE id = p_asset_id;

  -- End any current assignments
  UPDATE asset_assignments
  SET is_current = FALSE,
      returned_at = NOW()
  WHERE asset_id = p_asset_id
    AND is_current = TRUE;

  -- Create new assignment
  INSERT INTO asset_assignments (
    asset_id,
    assigned_to,
    assignment_type,
    assigned_by,
    notes,
    is_current
  ) VALUES (
    p_asset_id,
    p_assigned_to,
    p_assignment_type,
    p_assigned_by,
    p_notes,
    TRUE
  ) RETURNING id INTO v_assignment_id;

  -- Update asset status
  UPDATE assets
  SET status = 'assigned',
      updated_at = NOW()
  WHERE id = p_asset_id;

  -- Create audit log
  PERFORM log_audit(
    'assign',
    'asset',
    p_asset_id,
    NULL,
    jsonb_build_object(
      'assigned_to', p_assigned_to,
      'assignment_type', p_assignment_type,
      'assigned_by', p_assigned_by
    )
  );

  RETURN v_assignment_id;
END;
$$;


ALTER FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assignment_type" "text", "p_assigned_by" "uuid", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_department_lead"("p_department_id" "uuid", "p_new_lead_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_dept_name TEXT;
BEGIN
    -- 1. Get department name
    SELECT name INTO v_dept_name FROM departments WHERE id = p_department_id;
    
    IF v_dept_name IS NULL THEN
        RAISE EXCEPTION 'Department not found';
    END IF;

    -- 2. Validate new lead exists and is active
    IF NOT EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = p_new_lead_id 
        AND employment_status = 'active'
    ) THEN
        RAISE EXCEPTION 'New lead profile not found or inactive';
    END IF;

    -- 3. Demote current lead(s) for this department
    UPDATE profiles
    SET is_department_lead = false
    WHERE department_id = p_department_id 
       OR id IN (SELECT department_head_id FROM departments WHERE id = p_department_id);

    -- 4. Update the department record
    UPDATE departments
    SET department_head_id = p_new_lead_id,
        updated_at = NOW()
    WHERE id = p_department_id;

    -- 5. Promote the new lead
    UPDATE profiles
    SET role = 'lead',
        department = v_dept_name,
        department_id = p_department_id,
        is_department_lead = true,
        updated_at = NOW()
    WHERE id = p_new_lead_id;

END;
$$;


ALTER FUNCTION "public"."assign_department_lead"("p_department_id" "uuid", "p_new_lead_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_device"("p_device_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  previous_assigned_to uuid;
BEGIN
  -- Lock any current assignments for this device
  SELECT assigned_to
  INTO previous_assigned_to
  FROM device_assignments
  WHERE device_id = p_device_id AND is_current = true
  ORDER BY assigned_at DESC
  LIMIT 1
  FOR UPDATE;

  -- Mark all existing assignments as not current
  UPDATE device_assignments
  SET
    is_current = false,
    handed_over_at = NOW(),
    handover_notes = 'Reassigned via assign_device()'
  WHERE device_id = p_device_id AND is_current = true;

  -- Insert the new assignment
  INSERT INTO device_assignments (
    device_id,
    assigned_to,
    assigned_from,
    assigned_by,
    assignment_notes,
    is_current
  )
  VALUES (
    p_device_id,
    p_assigned_to,
    previous_assigned_to,
    p_assigned_by,
    p_assignment_notes,
    true
  );

  -- Ensure device status is marked as assigned
  UPDATE devices
  SET status = 'assigned'
  WHERE id = p_device_id;

  RETURN previous_assigned_to;
END;
$$;


ALTER FUNCTION "public"."assign_device"("p_device_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_asset_assignment_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_action TEXT;
    v_asset_data RECORD;
    v_assigned_user RECORD;
    v_from_user RECORD;
    v_new_values JSONB;
    v_old_values JSONB;
BEGIN
    -- Get asset info
    SELECT id, unique_code, asset_name, asset_type, serial_number, department, office_location
    INTO v_asset_data
    FROM assets WHERE id = NEW.asset_id;

    -- Get assigned-to user info (including employee_number)
    SELECT id, first_name, last_name, department, employee_number
    INTO v_assigned_user
    FROM profiles WHERE id = NEW.assigned_to;

    -- Determine action
    IF TG_OP = 'INSERT' THEN
        IF NEW.assigned_from IS NOT NULL THEN
            v_action := 'reassign';
            SELECT id, first_name, last_name, department, employee_number
            INTO v_from_user
            FROM profiles WHERE id = NEW.assigned_from;
        ELSE
            v_action := 'assign';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'update';
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'unassign';
    END IF;

    -- Build comprehensive new_values with ALL relevant data
    v_new_values := jsonb_build_object(
        -- Assignment info
        'id', NEW.id,
        'asset_id', NEW.asset_id,
        'assignment_type', NEW.assignment_type,
        'office_location', NEW.office_location,
        'is_current', NEW.is_current,
        'assigned_at', NEW.assigned_at,
        
        -- Asset info
        'unique_code', v_asset_data.unique_code,
        'asset_name', v_asset_data.asset_name,
        'asset_type', v_asset_data.asset_type,
        'serial_number', v_asset_data.serial_number,
        
        -- Assigned-to user info
        'assigned_to', NEW.assigned_to,
        'assigned_to_name', CONCAT(v_assigned_user.first_name, ' ', v_assigned_user.last_name),
        'assigned_to_employee_number', v_assigned_user.employee_number,
        'department', COALESCE(v_assigned_user.department, v_asset_data.department, v_asset_data.office_location),
        
        -- Assigned-from user info (for reassignments)
        'assigned_from', NEW.assigned_from,
        'assigned_from_name', CASE WHEN v_from_user.id IS NOT NULL 
            THEN CONCAT(v_from_user.first_name, ' ', v_from_user.last_name) ELSE NULL END,
        'assigned_from_employee_number', v_from_user.employee_number
    );

    -- Build old_values if update/delete
    IF TG_OP != 'INSERT' THEN
        v_old_values := to_jsonb(OLD);
    END IF;

    -- Insert ONE comprehensive audit log entry
    INSERT INTO audit_logs (
        user_id, operation, action, table_name, entity_type,
        record_id, entity_id, old_values, new_values,
        department, metadata, status
    )
    VALUES (
        auth.uid(), TG_OP, v_action, 'asset_assignments', 'assets',
        NEW.id::TEXT, NEW.asset_id::TEXT, v_old_values, v_new_values,
        COALESCE(v_assigned_user.department, v_asset_data.department, v_asset_data.office_location),
        jsonb_build_object('trigger', TG_NAME, 'assignment_id', NEW.id),
        'success'
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Assignment audit error: %', SQLERRM;
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


ALTER FUNCTION "public"."audit_asset_assignment_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_old_data JSONB;
    v_new_data JSONB;
    v_action TEXT;
    v_entity_type TEXT;
    v_entity_id TEXT;
    v_department TEXT;
    v_changed_fields TEXT[] := ARRAY[]::TEXT[];
    v_key TEXT;
    v_old_val JSONB;
    v_new_val JSONB;
BEGIN
    -- Set entity type to table name (always plural)
    v_entity_type := TG_TABLE_NAME;

    -- Determine the action and data
    IF (TG_OP = 'INSERT') THEN
        v_action := 'create';
        v_new_data := to_jsonb(NEW);
        v_entity_id := NEW.id::TEXT;
        
        SELECT array_agg(key) INTO v_changed_fields
        FROM jsonb_object_keys(v_new_data) AS key;
        
    ELSIF (TG_OP = 'UPDATE') THEN
        v_action := 'update';
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
        v_entity_id := NEW.id::TEXT;
        
        -- SKIP assignment-related updates for assets (let assignment trigger handle)
        IF TG_TABLE_NAME = 'assets' THEN
            IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'assigned' THEN
                RETURN NEW;
            END IF;
        END IF;
        
        -- Compute changed fields
        FOR v_key IN SELECT jsonb_object_keys(v_new_data)
        LOOP
            v_old_val := v_old_data -> v_key;
            v_new_val := v_new_data -> v_key;
            
            IF v_key IN ('updated_at', 'created_at') THEN
                CONTINUE;
            END IF;
            
            IF (v_old_val IS DISTINCT FROM v_new_val) THEN
                v_changed_fields := array_append(v_changed_fields, v_key);
            END IF;
        END LOOP;
        
        -- Skip if no meaningful changes
        IF array_length(v_changed_fields, 1) IS NULL OR array_length(v_changed_fields, 1) = 0 THEN
            RETURN NEW;
        END IF;
        
    ELSIF (TG_OP = 'DELETE') THEN
        v_action := 'delete';
        v_old_data := to_jsonb(OLD);
        v_new_data := v_old_data;  -- For delete, store the deleted data in new_values too
        v_entity_id := OLD.id::TEXT;
        
        SELECT array_agg(key) INTO v_changed_fields
        FROM jsonb_object_keys(v_old_data) AS key;
    END IF;

    -- Extract department based on table type
    IF TG_TABLE_NAME = 'assets' THEN
        v_department := COALESCE(NEW.department, NEW.office_location, OLD.department, OLD.office_location);
    ELSIF TG_TABLE_NAME IN ('department_payments', 'payment_documents') THEN
        v_department := COALESCE(NEW.department, OLD.department);
    ELSIF TG_TABLE_NAME = 'profiles' THEN
        v_department := COALESCE(NEW.department, OLD.department);
    ELSIF TG_TABLE_NAME = 'tasks' THEN
        v_department := COALESCE(NEW.department, OLD.department);
    ELSIF TG_TABLE_NAME = 'performance_reviews' THEN
        v_department := COALESCE(NEW.department, OLD.department);
    ELSIF TG_TABLE_NAME = 'attendance_records' THEN
        v_department := COALESCE(NEW.department, OLD.department);
    ELSIF TG_TABLE_NAME = 'leave_requests' THEN
        -- Lookup department from profile
        SELECT department INTO v_department FROM profiles WHERE id = COALESCE(NEW.user_id, OLD.user_id);
    END IF;

    -- Insert audit log
    INSERT INTO audit_logs (
        user_id, operation, action, table_name, entity_type,
        record_id, entity_id, old_values, new_values,
        changed_fields, department, metadata, status
    )
    VALUES (
        auth.uid(), TG_OP, v_action, TG_TABLE_NAME, v_entity_type,
        v_entity_id, v_entity_id, v_old_data, v_new_data,
        v_changed_fields, v_department,
        jsonb_build_object('trigger', TG_NAME, 'schema', TG_TABLE_SCHEMA),
        'success'
    );

    IF (TG_OP = 'DELETE') THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Audit log error: %', SQLERRM;
        IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


ALTER FUNCTION "public"."audit_log_changes"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."audit_log_changes"() IS 'Trigger function for comprehensive audit logging. 
Captures only changed fields on UPDATE, includes department context, 
and handles errors gracefully without blocking operations.';



CREATE OR REPLACE FUNCTION "public"."auto_add_payment_category"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    INSERT INTO public.payment_categories (name)
    VALUES (NEW.category)
    ON CONFLICT (name) DO NOTHING;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_add_payment_category"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."broadcast_event_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    admin_user_id UUID;
BEGIN
    -- Only broadcast if severity is not 'low'
    IF NEW.severity IN ('medium', 'high', 'critical') THEN
        -- Loop through all admin users
        FOR admin_user_id IN 
            SELECT user_id FROM public.user_roles WHERE role = 'admin'
        LOOP
            INSERT INTO public.notifications (
                user_id,
                type,
                title,
                message,
                data,
                priority,
                created_at
            ) VALUES (
                admin_user_id,
                'grid_event',
                'Grid Alert: ' || NEW.event_type,
                NEW.description,
                jsonb_build_object(
                    'event_id', NEW.event_id,
                    'meter_id', NEW.meter_id,
                    'odyssey_meter_id', NEW.odyssey_meter_id,
                    'severity', NEW.severity
                ),
                CASE 
                    WHEN NEW.severity = 'critical' THEN 'urgent'
                    WHEN NEW.severity = 'high' THEN 'high'
                    ELSE 'normal'
                END,
                NOW()
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."broadcast_event_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_acquisition_year_order"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  latest_year INTEGER;
BEGIN
  -- Only check on INSERT (not UPDATE)
  IF TG_OP = 'INSERT' THEN
    -- Get the latest (maximum) acquisition year for this asset type
    SELECT MAX(acquisition_year) INTO latest_year
    FROM assets
    WHERE asset_type = NEW.asset_type;

    -- If there are existing assets of this type and the new year is earlier, reject
    IF latest_year IS NOT NULL AND NEW.acquisition_year < latest_year THEN
      RAISE EXCEPTION 'Cannot create asset with acquisition year %. Latest acquisition year for asset type % is %. New assets must be from year % or later.',
        NEW.acquisition_year,
        NEW.asset_type,
        latest_year,
        latest_year
        USING ERRCODE = '23514'; -- check_violation error code
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_acquisition_year_order"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_acquisition_year_order"() IS 'Prevents creating assets with acquisition years before the latest year for that asset type. Example: If TB (Table) exists with year 2025, cannot create TB with year 2024. Enforces chronological asset acquisition recording.';



CREATE OR REPLACE FUNCTION "public"."check_and_lift_expired_suspensions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Update suspensions where end_date has passed
  UPDATE employee_suspensions
  SET 
    is_active = false,
    lifted_at = now(),
    lift_reason = 'Automatically lifted - suspension period ended'
  WHERE 
    is_active = true 
    AND end_date IS NOT NULL 
    AND end_date < CURRENT_DATE;
    
  -- Update profiles for employees whose suspensions were lifted
  UPDATE profiles p
  SET 
    employment_status = 'active',
    status_changed_at = now(),
    updated_at = now()
  FROM employee_suspensions s
  WHERE 
    p.id = s.employee_id
    AND p.employment_status = 'suspended'
    AND s.is_active = false
    AND s.lifted_at = (
      SELECT MAX(lifted_at) 
      FROM employee_suspensions 
      WHERE employee_id = p.id AND is_active = false
    )
    AND NOT EXISTS (
      SELECT 1 FROM employee_suspensions 
      WHERE employee_id = p.id AND is_active = true
    );
END;
$$;


ALTER FUNCTION "public"."check_and_lift_expired_suspensions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_asset_deletion_allowed"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  current_serial INTEGER;
  asset_type_val TEXT;
  higher_serial_exists BOOLEAN;
BEGIN
  -- Only check on DELETE
  IF TG_OP = 'DELETE' THEN
    -- Extract serial number from unique_code
    current_serial := extract_serial_number(OLD.unique_code);
    
    -- If we can't extract serial number, allow deletion (might be old format)
    IF current_serial IS NULL THEN
      RETURN OLD;
    END IF;
    
    asset_type_val := OLD.asset_type;
    
    -- Check if any asset with same type (regardless of year) has a higher serial number
    SELECT EXISTS(
      SELECT 1
      FROM assets
      WHERE asset_type = asset_type_val
        AND id != OLD.id
        AND extract_serial_number(unique_code) > current_serial
        AND extract_serial_number(unique_code) IS NOT NULL
    ) INTO higher_serial_exists;
    
    -- If higher-numbered asset exists, prevent deletion
    IF higher_serial_exists THEN
      RAISE EXCEPTION 
        'Cannot delete asset %. Higher-numbered assets exist for asset type %. Delete assets in reverse order (highest number first) to maintain sequential numbering.',
        OLD.unique_code,
        asset_type_val
        USING ERRCODE = '23514'; -- check_violation
    END IF;
  END IF;
  
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."check_asset_deletion_allowed"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_asset_deletion_allowed"() IS 'Prevents deletion of assets if higher-numbered assets exist for the same type (year doesn''t matter). Example: Cannot delete ACOB/HQ/CHAIR/2023/014 if ACOB/HQ/CHAIR/2024/015 exists. Enforces sequential numbering by requiring deletion in reverse order.';



CREATE OR REPLACE FUNCTION "public"."cleanup_old_notifications"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Archive read notifications older than 30 days
  UPDATE notifications
  SET archived = TRUE, archived_at = NOW()
  WHERE read = TRUE 
    AND created_at < NOW() - INTERVAL '30 days'
    AND archived = FALSE;
  
  -- Delete archived notifications older than 90 days
  DELETE FROM notifications
  WHERE archived = TRUE
    AND archived_at < NOW() - INTERVAL '90 days';
    
  -- Delete expired notifications
  DELETE FROM notifications
  WHERE expires_at IS NOT NULL
    AND expires_at < NOW();
END;
$$;


ALTER FUNCTION "public"."cleanup_old_notifications"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_old_notifications"() IS 'Clean up old archived and expired notifications';



CREATE OR REPLACE FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_data" "jsonb" DEFAULT '{}'::"jsonb", "p_action_url" "text" DEFAULT NULL::"text", "p_priority" "text" DEFAULT 'normal'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  notification_id UUID;
BEGIN
  INSERT INTO notifications (
    user_id, type, title, message, data, action_url, priority
  ) VALUES (
    p_user_id, p_type, p_title, p_message, p_data, p_action_url, p_priority
  )
  RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$;


ALTER FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_data" "jsonb", "p_action_url" "text", "p_priority" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text" DEFAULT 'normal'::"text", "p_action_url" "text" DEFAULT NULL::"text", "p_action_label" "text" DEFAULT NULL::"text", "p_related_entity_type" "text" DEFAULT NULL::"text", "p_related_entity_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  notification_id UUID;
BEGIN
  INSERT INTO notifications (
    user_id,
    type,
    category,
    title,
    message,
    priority,
    action_url,
    action_label,
    related_entity_type,
    related_entity_id,
    metadata
  ) VALUES (
    p_user_id,
    p_type,
    p_category,
    p_title,
    p_message,
    p_priority,
    p_action_url,
    p_action_label,
    p_related_entity_type,
    p_related_entity_id,
    p_metadata
  ) RETURNING id INTO notification_id;

  RETURN notification_id;
END;
$$;


ALTER FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text", "p_action_url" "text", "p_action_label" "text", "p_related_entity_type" "text", "p_related_entity_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text" DEFAULT 'normal'::"text", "p_link_url" "text" DEFAULT NULL::"text", "p_actor_id" "uuid" DEFAULT NULL::"uuid", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "uuid" DEFAULT NULL::"uuid", "p_rich_content" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_notification_id UUID;
  v_preferences RECORD;
BEGIN
  -- Check user preferences
  SELECT * INTO v_preferences
  FROM notification_preferences
  WHERE user_id = p_user_id;
  
  -- If no preferences exist, create defaults
  IF NOT FOUND THEN
    INSERT INTO notification_preferences (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    
    v_preferences.in_app_enabled := TRUE;
  END IF;
  
  -- Only create if in-app notifications are enabled for this category
  IF v_preferences.in_app_enabled THEN
    INSERT INTO notifications (
      user_id,
      type,
      category,
      priority,
      title,
      message,
      link_url,
      actor_id,
      entity_type,
      entity_id,
      rich_content
    ) VALUES (
      p_user_id,
      p_type,
      p_category,
      p_priority,
      p_title,
      p_message,
      p_link_url,
      p_actor_id,
      p_entity_type,
      p_entity_id,
      p_rich_content
    )
    RETURNING id INTO v_notification_id;
    
    RETURN v_notification_id;
  END IF;
  
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text", "p_link_url" "text", "p_actor_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_rich_content" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text", "p_link_url" "text", "p_actor_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_rich_content" "jsonb") IS 'Helper function to create notifications with automatic preference checks';



CREATE OR REPLACE FUNCTION "public"."create_starlink_payment_reminders"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_payment RECORD;
  v_notification_id UUID;
  v_count INTEGER := 0;
  v_admin_users UUID[];
BEGIN
  -- Get all admin and super_admin users
  SELECT ARRAY_AGG(id) INTO v_admin_users
  FROM profiles
  WHERE role IN ('admin', 'super_admin');
  
  -- Loop through payments due in 7 days that haven't had reminders sent
  FOR v_payment IN 
    SELECT * FROM get_upcoming_starlink_payments(7)
    WHERE reminder_sent = FALSE
      AND days_until_due <= 7
  LOOP
    -- Create notification for each admin user
    FOR i IN 1..COALESCE(array_length(v_admin_users, 1), 0) LOOP
      SELECT create_notification(
        v_admin_users[i],
        'system',
        'system',
        'Starlink Payment Due Soon',
        format('Payment for %s (%s) is due in %s days. Invoice: %s. Please raise requisition.',
          v_payment.site_name,
          v_payment.state,
          v_payment.days_until_due,
          v_payment.invoice_number
        ),
        CASE 
          WHEN v_payment.days_until_due <= 3 THEN 'urgent'
          WHEN v_payment.days_until_due <= 5 THEN 'high'
          ELSE 'normal'
        END,
        format('/admin/starlink/payments?payment_id=%s', v_payment.payment_id),
        NULL,
        'starlink_payment',
        v_payment.payment_id,
        jsonb_build_object(
          'site_name', v_payment.site_name,
          'state', v_payment.state,
          'due_date', v_payment.next_payment_due,
          'amount', v_payment.amount
        )
      ) INTO v_notification_id;
    END LOOP;
    
    -- Mark reminder as sent
    UPDATE starlink_payments
    SET reminder_sent = TRUE,
        reminder_sent_at = NOW()
    WHERE id = v_payment.payment_id;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."create_starlink_payment_reminders"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_starlink_payment_reminders"() IS 'Creates notifications for upcoming payments and returns count of reminders created';



CREATE OR REPLACE FUNCTION "public"."extract_serial_number"("asset_number" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- Extract serial number from asset number format: PREFIX-SERIAL-SUFFIX
  -- Example: ACC-DF-10220671-51752-35 -> 10220671
  RETURN split_part(asset_number, '-', 3);
END;
$$;


ALTER FUNCTION "public"."extract_serial_number"("asset_number" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_last_sync_timestamp"("p_sync_type" "text") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    last_sync TIMESTAMPTZ;
BEGIN
    SELECT last_sync_at INTO last_sync
    FROM sync_state
    WHERE sync_type = p_sync_type
    ORDER BY last_sync_at DESC
    LIMIT 1;
    
    RETURN COALESCE(last_sync, '2020-01-01'::TIMESTAMPTZ);
END;
$$;


ALTER FUNCTION "public"."get_last_sync_timestamp"("p_sync_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_asset_serial"("asset_code" "text", "year" integer) RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  next_serial INTEGER;
  serial_str TEXT;
  min_year INTEGER;
  max_year INTEGER;
BEGIN
  -- Get the year range for this asset type
  SELECT
    MIN(acquisition_year),
    MAX(acquisition_year)
  INTO min_year, max_year
  FROM assets
  WHERE asset_type = asset_code;

  -- If assets exist, check if we're trying to add an earlier year
  IF min_year IS NOT NULL AND year < min_year THEN
    RAISE EXCEPTION 'Cannot add asset with year % because assets from year % already exist. You cannot acquire assets in the past!',
      year, min_year;
  END IF;

  -- Find the highest serial number across ALL years
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(unique_code FROM '[0-9]+$') AS INTEGER
    )
  ), 0) + 1
  INTO next_serial
  FROM assets
  WHERE unique_code ~ ('^ACOB/HQ/' || asset_code || '/[0-9]{4}/[0-9]{3}$');

  -- Format as 3-digit serial
  serial_str := LPAD(next_serial::TEXT, 3, '0');

  RETURN 'ACOB/HQ/' || asset_code || '/' || year::text || '/' || serial_str;
END;
$_$;


ALTER FUNCTION "public"."get_next_asset_serial"("asset_code" "text", "year" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_starlink_dashboard_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_stats JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_sites', (SELECT COUNT(*) FROM starlink_sites WHERE is_active = TRUE),
    'active_sites', (SELECT COUNT(*) FROM starlink_sites WHERE is_active = TRUE),
    'total_payments', (SELECT COUNT(*) FROM starlink_payments),
    'pending_payments', (SELECT COUNT(*) FROM starlink_payments WHERE payment_status = 'pending'),
    'overdue_payments', (SELECT COUNT(*) FROM starlink_payments WHERE payment_status = 'overdue'),
    'payments_due_this_week', (
      SELECT COUNT(*) 
      FROM starlink_payments 
      WHERE payment_status = 'pending' 
        AND next_payment_due BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
    ),
    'payments_due_this_month', (
      SELECT COUNT(*) 
      FROM starlink_payments 
      WHERE payment_status = 'pending' 
        AND next_payment_due BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
    ),
    'total_amount_pending', (
      SELECT COALESCE(SUM(amount), 0) 
      FROM starlink_payments 
      WHERE payment_status = 'pending'
    ),
    'upcoming_payments', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'site_name', site_name,
          'state', state,
          'due_date', next_payment_due,
          'days_until_due', days_until_due,
          'amount', amount
        )
      )
      FROM get_upcoming_starlink_payments(7)
    )
  ) INTO v_stats;
  
  RETURN v_stats;
END;
$$;


ALTER FUNCTION "public"."get_starlink_dashboard_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_starlink_dashboard_stats"() IS 'Returns comprehensive dashboard statistics';



CREATE OR REPLACE FUNCTION "public"."get_system_setting"("key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT setting_value INTO result
  FROM system_settings
  WHERE setting_key = key;
  
  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;


ALTER FUNCTION "public"."get_system_setting"("key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_upcoming_starlink_payments"("days_ahead" integer DEFAULT 7) RETURNS TABLE("payment_id" "uuid", "site_id" "uuid", "site_name" "text", "state" "text", "next_payment_due" "date", "days_until_due" integer, "invoice_number" "text", "amount" numeric, "reminder_sent" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS payment_id,
    s.id AS site_id,
    s.site_name,
    s.state,
    p.next_payment_due,
    (p.next_payment_due - CURRENT_DATE)::INTEGER AS days_until_due,
    p.invoice_number,
    p.amount,
    p.reminder_sent
  FROM starlink_payments p
  JOIN starlink_sites s ON p.site_id = s.id
  WHERE p.payment_status = 'pending'
    AND p.next_payment_due <= CURRENT_DATE + days_ahead
    AND p.next_payment_due >= CURRENT_DATE
    AND s.is_active = TRUE
  ORDER BY p.next_payment_due ASC;
END;
$$;


ALTER FUNCTION "public"."get_upcoming_starlink_payments"("days_ahead" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_upcoming_starlink_payments"("days_ahead" integer) IS 'Returns payments due within specified days';



CREATE OR REPLACE FUNCTION "public"."handle_departments_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_departments_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_dept_payments_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_dept_payments_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  project_url text := 'https://itqegqxeqkeogwrvlzlj.supabase.co';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NDI0NTcsImV4cCI6MjA3NzIxODQ1N30.eVYpuw_VqDrg28DXJFoeYGAbth4Q-t0tXokA1Nq1dog';
begin
  perform
    net.http_post(
      url:=project_url || '/functions/v1/send-email-notification',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body:=jsonb_build_object(
        'type', TG_OP,
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA,
        'record', row_to_json(NEW),
        'old_record', null
      )
    );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, company_email, employment_status)
  VALUES (NEW.id, NEW.email, 'active');
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("required_role" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM user_roles
  WHERE user_id = auth.uid();
  
  CASE required_role
    WHEN 'visitor' THEN
      RETURN user_role IN ('visitor', 'employee', 'lead', 'admin', 'super_admin');
    WHEN 'employee' THEN
      RETURN user_role IN ('employee', 'lead', 'admin', 'super_admin');
    WHEN 'lead' THEN
      RETURN user_role IN ('lead', 'admin', 'super_admin');
    WHEN 'admin' THEN
      RETURN user_role IN ('admin', 'super_admin');
    WHEN 'super_admin' THEN
      RETURN user_role = 'super_admin';
    ELSE
      RETURN false;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."has_role"("required_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit"("p_action" "text", "p_entity_type" "text", "p_entity_id" "text", "p_user_id" "uuid" DEFAULT NULL::"uuid", "p_old_values" "jsonb" DEFAULT NULL::"jsonb", "p_new_values" "jsonb" DEFAULT NULL::"jsonb", "p_metadata" "jsonb" DEFAULT NULL::"jsonb", "p_site_id" "text" DEFAULT NULL::"text", "p_department" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_audit_id UUID;
    v_user_id UUID;
    v_changed_fields TEXT[];
BEGIN
    -- Use provided user_id or get current auth user
    v_user_id := COALESCE(p_user_id, auth.uid());
    
    -- Extract changed fields from new_values if provided
    IF p_new_values IS NOT NULL THEN
        SELECT array_agg(key) INTO v_changed_fields
        FROM jsonb_object_keys(p_new_values) AS key;
    END IF;
    
    INSERT INTO audit_logs (
        user_id,
        action,
        operation,
        entity_type,
        table_name,
        entity_id,
        record_id,
        old_values,
        new_values,
        changed_fields,
        department,
        metadata,
        site_id,
        status
    )
    VALUES (
        v_user_id,
        p_action,
        p_action,
        p_entity_type,
        p_entity_type,
        p_entity_id,
        p_entity_id,
        p_old_values,
        p_new_values,
        v_changed_fields,
        p_department,
        COALESCE(p_metadata, '{}'::JSONB),
        p_site_id,
        'success'
    )
    RETURNING id INTO v_audit_id;
    
    RETURN v_audit_id;
END;
$$;


ALTER FUNCTION "public"."log_audit"("p_action" "text", "p_entity_type" "text", "p_entity_id" "text", "p_user_id" "uuid", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_metadata" "jsonb", "p_site_id" "text", "p_department" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_audit"("p_action" "text", "p_entity_type" "text", "p_entity_id" "text", "p_user_id" "uuid", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_metadata" "jsonb", "p_site_id" "text", "p_department" "text") IS 'RPC function for frontend audit logging.
Use this to log actions from the application layer.
Accepts optional department parameter for financial and departmental context.';



CREATE OR REPLACE FUNCTION "public"."log_crm_contact_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
    VALUES (auth.uid(), 'create', 'crm_contact', NEW.id, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
    VALUES (auth.uid(), 'update', 'crm_contact', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values)
    VALUES (auth.uid(), 'delete', 'crm_contact', OLD.id, to_jsonb(OLD));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."log_crm_contact_audit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_crm_opportunity_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
    VALUES (auth.uid(), 'create', 'crm_opportunity', NEW.id, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
    VALUES (auth.uid(), 'update', 'crm_opportunity', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values)
    VALUES (auth.uid(), 'delete', 'crm_opportunity', OLD.id, to_jsonb(OLD));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."log_crm_opportunity_audit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_all_notifications_read"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  affected_rows INTEGER;
BEGIN
  UPDATE notifications
  SET read = true, read_at = now()
  WHERE user_id = auth.uid() AND read = false;
  
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;


ALTER FUNCTION "public"."mark_all_notifications_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notification_read"("notification_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE notifications
  SET read = true, read_at = now()
  WHERE id = notification_id AND user_id = auth.uid();
  
  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."mark_notification_read"("notification_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notifications_read"("p_user_id" "uuid", "p_notification_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_notification_ids IS NULL THEN
    -- Mark all as read
    UPDATE notifications
    SET read = TRUE, read_at = NOW()
    WHERE user_id = p_user_id AND read = FALSE;
  ELSE
    -- Mark specific ones as read
    UPDATE notifications
    SET read = TRUE, read_at = NOW()
    WHERE user_id = p_user_id 
      AND id = ANY(p_notification_ids)
      AND read = FALSE;
  END IF;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."mark_notifications_read"("p_user_id" "uuid", "p_notification_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_notifications_read"("p_user_id" "uuid", "p_notification_ids" "uuid"[]) IS 'Bulk mark notifications as read';



CREATE OR REPLACE FUNCTION "public"."notify_task_completed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  user_id UUID;
  notification_type TEXT;
  notification_title TEXT;
BEGIN
  IF NEW.status IN ('completed', 'failed') AND OLD.status != NEW.status THEN
    SELECT NEW.created_by INTO user_id;
    
    IF NEW.status = 'completed' THEN
      notification_type := 'task_completed';
      notification_title := 'Task Completed Successfully';
    ELSE
      notification_type := 'task_failed';
      notification_title := 'Task Failed';
    END IF;
    
    PERFORM create_notification(
      user_id,
      notification_type,
      notification_title,
      format('Remote task for meter %s has %s', NEW.meter_id, NEW.status),
      jsonb_build_object(
        'task_id', NEW.id,
        'meter_id', NEW.meter_id,
        'task_type', NEW.task_type,
        'status', NEW.status,
        'error_message', NEW.error_message
      ),
      '/tasks/' || NEW.task_type,
      CASE WHEN NEW.status = 'failed' THEN 'high' ELSE 'normal' END
    );
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_task_completed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_token_generated"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  user_id UUID;
BEGIN
  SELECT NEW.generated_by INTO user_id;
  
  PERFORM create_notification(
    user_id,
    'token_generated',
    'Token Generated Successfully',
    format('Token %s generated for meter %s', NEW.token, NEW.meter_id),
    jsonb_build_object(
      'token_id', NEW.id,
      'token', NEW.token,
      'meter_id', NEW.meter_id,
      'amount', NEW.amount,
      'units', NEW.units
    ),
    '/records/credit',
    'normal'
  );
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_token_generated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."populate_notification_actor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.actor_id IS NOT NULL AND NEW.actor_name IS NULL THEN
    SELECT 
      CONCAT(first_name, ' ', last_name),
      avatar_url
    INTO NEW.actor_name, NEW.actor_avatar
    FROM profiles
    WHERE id = NEW.actor_id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."populate_notification_actor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_sync_completion"("p_sync_type" "text", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_records_count" integer, "p_status" "text" DEFAULT 'success'::"text", "p_error" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
    sync_id UUID;
BEGIN
    INSERT INTO sync_state (
        sync_type,
        last_sync_at,
        last_sync_from,
        last_sync_to,
        records_synced,
        status,
        error_message
    ) VALUES (
        p_sync_type,
        NOW(),
        p_from,
        p_to,
        p_records_count,
        p_status,
        p_error
    )
    RETURNING id INTO sync_id;
    
    RETURN sync_id;
END;
$$;


ALTER FUNCTION "public"."record_sync_completion"("p_sync_type" "text", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_records_count" integer, "p_status" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_contact_from_customer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.crm_contact_id IS NOT NULL THEN
    UPDATE crm_contacts
    SET
      contact_name = NEW.name,
      phone = COALESCE(NEW.phone, phone),
      email = COALESCE(NEW.email, email),
      updated_at = now()
    WHERE id = NEW.crm_contact_id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_contact_from_customer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_customer_from_contact"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.meter_customer_id IS NOT NULL THEN
    UPDATE customers
    SET
      name = NEW.contact_name,
      phone = COALESCE(NEW.phone, phone),
      email = COALESCE(NEW.email, email),
      updated_at = now()
    WHERE id = NEW.meter_customer_id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_customer_from_contact"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_asset_issues_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_asset_issues_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_asset_types_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_asset_types_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_crm_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_crm_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_employee_suspensions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_employee_suspensions_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_office_locations_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_office_locations_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_overdue_starlink_payments"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE starlink_payments
  SET payment_status = 'overdue',
      updated_at = NOW()
  WHERE payment_status = 'pending'
    AND next_payment_due < CURRENT_DATE;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."update_overdue_starlink_payments"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_overdue_starlink_payments"() IS 'Updates payment status to overdue for past due payments';



CREATE OR REPLACE FUNCTION "public"."update_starlink_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_starlink_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_system_setting"("key" "text", "value" "jsonb", "user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  is_super_admin BOOLEAN;
BEGIN
  -- Check if user is super admin
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id
    AND role = 'super_admin'
  ) INTO is_super_admin;
  
  IF NOT is_super_admin THEN
    RAISE EXCEPTION 'Only super admins can update system settings';
  END IF;
  
  -- Update or insert the setting
  INSERT INTO system_settings (setting_key, setting_value, updated_by)
  VALUES (key, value, user_id)
  ON CONFLICT (setting_key)
  DO UPDATE SET
    setting_value = EXCLUDED.setting_value,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
  
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."update_system_setting"("key" "text", "value" "jsonb", "user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_task_status_from_completions"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  task_record tasks%ROWTYPE;
  total_assignments INTEGER;
  completed_count INTEGER;
BEGIN
  -- Get task details
  SELECT * INTO task_record FROM tasks WHERE id = NEW.task_id;
  
  -- Only process multiple-user tasks
  IF task_record.assignment_type = 'multiple' THEN
    -- Count total assignments
    SELECT COUNT(*) INTO total_assignments
    FROM task_assignments
    WHERE task_id = NEW.task_id;
    
    -- Count completed assignments
    SELECT COUNT(*) INTO completed_count
    FROM task_user_completion
    WHERE task_id = NEW.task_id;
    
    -- Update task status based on completion
    IF completed_count = total_assignments AND total_assignments > 0 THEN
      UPDATE tasks
      SET status = 'completed', completed_at = NOW()
      WHERE id = NEW.task_id;
    ELSIF completed_count > 0 THEN
      UPDATE tasks
      SET status = 'in_progress'
      WHERE id = NEW.task_id AND status = 'pending';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_task_status_from_completions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "target_user_id" "uuid",
    "changes" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_posting_id" "uuid" NOT NULL,
    "applicant_name" character varying(200) NOT NULL,
    "applicant_email" character varying(255) NOT NULL,
    "applicant_phone" character varying(50),
    "resume_url" "text",
    "cover_letter" "text",
    "status" character varying(20) DEFAULT 'applied'::character varying,
    "source" character varying(50),
    "applied_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."applications" OWNER TO "postgres";


COMMENT ON TABLE "public"."applications" IS 'HR recruitment system - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."asset_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "assigned_to" "uuid",
    "assigned_from" "uuid",
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "handed_over_at" timestamp with time zone,
    "assignment_notes" "text",
    "handover_notes" "text",
    "is_current" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "department" "text",
    "assignment_type" "text" DEFAULT 'individual'::"text",
    "office_location" "text",
    CONSTRAINT "asset_assignments_assignment_type_check" CHECK ((("assignment_type" IS NULL) OR ("assignment_type" = ANY (ARRAY['individual'::"text", 'department'::"text", 'office'::"text"]))))
);


ALTER TABLE "public"."asset_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_issues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "created_by" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."asset_issues" OWNER TO "postgres";


COMMENT ON TABLE "public"."asset_issues" IS 'Tracks issues/problems with assets (e.g., faulty RAM, broken screen)';



COMMENT ON COLUMN "public"."asset_issues"."asset_id" IS 'The asset this issue belongs to';



COMMENT ON COLUMN "public"."asset_issues"."description" IS 'Description of the issue';



COMMENT ON COLUMN "public"."asset_issues"."resolved" IS 'Whether the issue has been fixed';



COMMENT ON COLUMN "public"."asset_issues"."resolved_at" IS 'When the issue was marked as resolved';



COMMENT ON COLUMN "public"."asset_issues"."resolved_by" IS 'Who marked the issue as resolved';



COMMENT ON COLUMN "public"."asset_issues"."created_by" IS 'Who created the issue';



CREATE TABLE IF NOT EXISTS "public"."asset_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    "code" "text" NOT NULL,
    "requires_serial_model" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."asset_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_name" "text",
    "asset_type" "text" NOT NULL,
    "asset_model" "text",
    "serial_number" "text",
    "notes" "text",
    "status" "text" DEFAULT 'available'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "assignment_type" "text",
    "department" "text",
    "unique_code" "text" NOT NULL,
    "acquisition_year" integer,
    "office_location" "text",
    CONSTRAINT "assets_assignment_type_check" CHECK ((("assignment_type" IS NULL) OR ("assignment_type" = ANY (ARRAY['individual'::"text", 'department'::"text", 'office'::"text"])))),
    CONSTRAINT "assets_department_check" CHECK ((("department" IS NULL) OR ("department" = ANY (ARRAY['Accounts'::"text", 'Admin & HR'::"text", 'Business, Growth and Innovation'::"text", 'IT and Communications'::"text", 'Legal, Regulatory and Compliance'::"text", 'Logistics'::"text", 'Operations'::"text", 'Technical'::"text"])))),
    CONSTRAINT "assets_office_location_check" CHECK ((("office_location" IS NULL) OR ("office_location" = ANY (ARRAY['Accounts'::"text", 'Admin & HR'::"text", 'Assistant Executive Director'::"text", 'Business, Growth and Innovation'::"text", 'General Conference Room'::"text", 'IT and Communications'::"text", 'Kitchen'::"text", 'Legal, Regulatory and Compliance'::"text", 'MD Conference Room'::"text", 'MD Office'::"text", 'Operations'::"text", 'Reception'::"text", 'Site'::"text", 'Technical'::"text", 'Technical Extension'::"text"]))))
);


ALTER TABLE "public"."assets" OWNER TO "postgres";


COMMENT ON COLUMN "public"."assets"."asset_type" IS 'Asset type with codes: Desktop (DSKST), Laptop (LAP), Telephone (TELPH), FAN (FAN), Printer (PRINT), Router (ROUTER), Television (TELV), Office Save Drawer (SAVEDRW), Extension Box (EXTEN), Notice Board White (WHITE/BRD), Notice Board Black (BLACK/BRD), Office Table (TB), Table Side Drawer (OFF/DRAW), Chair (CHAIR), Executive Chair (EX/CHAIR), Deep Freezer (D/FREEZER), Microwave (MICROWAVE), Air Conditioner (AC), Visibility Banner (VBANNER), Generator (GEN)';



COMMENT ON COLUMN "public"."assets"."assignment_type" IS 'Assignment type: individual (assigned to person), department (assigned to department), office (assigned to office location)';



COMMENT ON COLUMN "public"."assets"."department" IS 'Department assignment (standardized list): Accounts, Admin & HR, Business, Growth and Innovation, IT and Communications, Legal, Regulatory and Compliance, Logistics, Operations, Technical';



COMMENT ON COLUMN "public"."assets"."unique_code" IS 'Unique asset identifier in format: ACOB/HQ/{TYPE_CODE}/{YEAR}/{SERIAL} e.g., ACOB/HQ/DSKST/24/001';



COMMENT ON COLUMN "public"."assets"."office_location" IS 'Office location/room for office assignments: Accounts, Admin & HR, Assistant Executive Director, Business, Growth and Innovation, General Conference Room, Kitchen, Legal, Regulatory and Compliance, MD Conference Room, MD Office, Media/Control, Operations, Reception, Technical, Technical Extension';



CREATE TABLE IF NOT EXISTS "public"."attendance_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "clock_in" time without time zone,
    "clock_out" time without time zone,
    "break_duration" integer DEFAULT 0,
    "total_hours" numeric(5,2),
    "overtime_hours" numeric(5,2) DEFAULT 0,
    "shift_id" "uuid",
    "status" character varying(20) DEFAULT 'present'::character varying,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."attendance_records" OWNER TO "postgres";


COMMENT ON TABLE "public"."attendance_records" IS 'HR time tracking - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "operation" "text" NOT NULL,
    "table_name" "text",
    "record_id" "text",
    "status" "text" NOT NULL,
    "error_details" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "site_id" "text",
    "action" "text",
    "entity_type" "text",
    "entity_id" "text",
    "old_values" "jsonb",
    "new_values" "jsonb",
    "department" "text",
    "changed_fields" "text"[],
    "ip_address" "inet",
    "user_agent" "text"
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."consumption_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meter_id" "uuid",
    "reading" numeric(10,2) NOT NULL,
    "reading_date" timestamp with time zone NOT NULL,
    "consumption" numeric(10,2),
    "source" character varying(20) DEFAULT 'manual'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "consumption_data_source_check" CHECK ((("source")::"text" = ANY ((ARRAY['manual'::character varying, 'automatic'::character varying, 'remote'::character varying])::"text"[])))
);


ALTER TABLE "public"."consumption_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_activities" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "contact_id" "uuid",
    "opportunity_id" "uuid",
    "type" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "description" "text",
    "due_date" timestamp with time zone,
    "duration_minutes" integer,
    "completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "outcome" "text",
    "priority" "text" DEFAULT 'normal'::"text",
    "assigned_to" "uuid",
    "reminder_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "crm_activities_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "crm_activities_type_check" CHECK (("type" = ANY (ARRAY['call'::"text", 'email'::"text", 'meeting'::"text", 'note'::"text", 'task'::"text", 'follow_up'::"text"])))
);


ALTER TABLE "public"."crm_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_contacts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "type" "text" NOT NULL,
    "company_name" "text",
    "contact_name" "text" NOT NULL,
    "title" "text",
    "email" "text",
    "phone" "text",
    "mobile" "text",
    "website" "text",
    "address" "jsonb",
    "industry" "text",
    "company_size" "text",
    "annual_revenue" numeric,
    "source" "text",
    "assigned_to" "uuid",
    "pipeline_id" "uuid",
    "stage" "text" DEFAULT 'new'::"text" NOT NULL,
    "score" integer DEFAULT 0,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "next_follow_up" timestamp with time zone,
    "notes" "text",
    "meter_customer_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "crm_contacts_score_check" CHECK ((("score" >= 0) AND ("score" <= 100))),
    CONSTRAINT "crm_contacts_type_check" CHECK (("type" = ANY (ARRAY['lead'::"text", 'customer'::"text", 'vendor'::"text", 'partner'::"text"])))
);


ALTER TABLE "public"."crm_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_opportunities" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "contact_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "value" numeric DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'NGN'::"text",
    "probability" integer DEFAULT 0,
    "pipeline_id" "uuid",
    "stage" "text" DEFAULT 'qualification'::"text" NOT NULL,
    "expected_close" "date",
    "assigned_to" "uuid",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "crm_opportunities_probability_check" CHECK ((("probability" >= 0) AND ("probability" <= 100))),
    CONSTRAINT "crm_opportunities_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'won'::"text", 'lost'::"text"])))
);


ALTER TABLE "public"."crm_opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_pipelines" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "stages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_default" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."crm_pipelines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_tags" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#3b82f6'::"text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."crm_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" character varying(20) NOT NULL,
    "name" character varying(100) NOT NULL,
    "phone" character varying(20),
    "email" character varying(255),
    "address" "text",
    "remark" "text",
    "crm_contact_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "external_id" character varying(50),
    "kyc_level" character varying(20),
    "account_balance" numeric(12,2) DEFAULT 0,
    "certifi_no" "text",
    "site_id" "text",
    "certifi_name" character varying(100)
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "payment_type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "amount" numeric(15,2),
    "currency" "text" DEFAULT 'NGN'::"text",
    "recurrence_period" "text",
    "next_payment_due" timestamp with time zone,
    "last_payment_date" timestamp with time zone,
    "payment_date" timestamp with time zone,
    "status" "text" DEFAULT 'due'::"text",
    "payment_reference" "text",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "issuer_name" "text",
    "issuer_phone_number" "text",
    "issuer_address" "text",
    "amount_paid" numeric DEFAULT 0,
    "invoice_number" "text",
    "site_id" "uuid",
    "site_name" "text",
    "site_state" "text",
    "site_serial_number" "text",
    CONSTRAINT "department_payments_payment_type_check" CHECK (("payment_type" = ANY (ARRAY['one-time'::"text", 'recurring'::"text"]))),
    CONSTRAINT "department_payments_recurrence_period_check" CHECK (("recurrence_period" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text", 'quarterly'::"text", 'yearly'::"text"]))),
    CONSTRAINT "department_payments_status_check" CHECK (("status" = ANY (ARRAY['due'::"text", 'paid'::"text", 'overdue'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."department_payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."department_payments" IS 'Department-based payment tracking system supporting one-time and recurring payments';



CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "department_head_id" "uuid",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


COMMENT ON TABLE "public"."departments" IS 'Master list of company departments';



CREATE TABLE IF NOT EXISTS "public"."employee_salaries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "basic_salary" numeric(10,2) NOT NULL,
    "effective_from" "date" NOT NULL,
    "effective_to" "date",
    "is_active" boolean DEFAULT true,
    "bank_account_number" character varying(50),
    "bank_name" character varying(100),
    "bank_sort_code" character varying(20),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."employee_salaries" OWNER TO "postgres";


COMMENT ON TABLE "public"."employee_salaries" IS 'HR payroll system - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."employee_suspensions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "suspended_by" "uuid",
    "reason" "text" NOT NULL,
    "start_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "end_date" "date",
    "is_active" boolean DEFAULT true,
    "lifted_by" "uuid",
    "lifted_at" timestamp with time zone,
    "lift_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."employee_suspensions" OWNER TO "postgres";


COMMENT ON TABLE "public"."employee_suspensions" IS 'Tracks employee suspension history with start/end dates, reasons, and who suspended/lifted';



CREATE TABLE IF NOT EXISTS "public"."event_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "text",
    "meter_id" "uuid",
    "odyssey_meter_id" "text",
    "event_type" "text" NOT NULL,
    "severity" "text" DEFAULT 'low'::"text",
    "description" "text" NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    "acknowledged" boolean DEFAULT false,
    "acknowledged_by" "uuid",
    "acknowledged_at" timestamp with time zone,
    "metadata" "jsonb",
    "source" "text" DEFAULT 'local'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "site_id" character varying(50),
    CONSTRAINT "event_notifications_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."event_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "feedback_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_anonymous" boolean DEFAULT false,
    CONSTRAINT "feedback_feedback_type_check" CHECK (("feedback_type" = ANY (ARRAY['concern'::"text", 'complaint'::"text", 'suggestion'::"text", 'required_item'::"text"]))),
    CONSTRAINT "feedback_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'resolved'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


COMMENT ON COLUMN "public"."feedback"."user_id" IS 'Nullable - null indicates anonymous feedback submission';



COMMENT ON COLUMN "public"."feedback"."is_anonymous" IS 'When true, user_id is null and the submission is truly anonymous';



CREATE TABLE IF NOT EXISTS "public"."firmware_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "firmware_id" "uuid",
    "meter_id" "uuid",
    "task_id" character varying(100),
    "status" character varying(50) DEFAULT 'queued'::character varying,
    "progress" integer DEFAULT 0,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "error_log" "text"
);


ALTER TABLE "public"."firmware_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."firmware_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "version" character varying(50) NOT NULL,
    "file_url" "text" NOT NULL,
    "release_notes" "text",
    "target_models" "text"[],
    "is_critical" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."firmware_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gateways" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gateway_id" character varying(20) NOT NULL,
    "name" character varying(100) NOT NULL,
    "status" character varying(20) DEFAULT 'offline'::character varying,
    "location" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "gateways_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['online'::character varying, 'offline'::character varying])::"text"[])))
);


ALTER TABLE "public"."gateways" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."goals_objectives" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "review_cycle_id" "uuid",
    "title" character varying(200) NOT NULL,
    "description" "text",
    "target_value" numeric(10,2),
    "achieved_value" numeric(10,2) DEFAULT 0,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "priority" character varying(20) DEFAULT 'medium'::character varying,
    "due_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."goals_objectives" OWNER TO "postgres";


COMMENT ON TABLE "public"."goals_objectives" IS 'HR performance management - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."gprs_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meter_id" "uuid",
    "odyssey_meter_id" "text",
    "is_online" boolean DEFAULT false,
    "last_seen" timestamp with time zone,
    "signal_strength" integer,
    "connection_type" "text",
    "apn" "text",
    "ip_address" "inet",
    "uptime_percentage" numeric(5,2),
    "last_disconnect_reason" "text",
    "heartbeat_interval" integer,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "gprs_status_signal_strength_check" CHECK ((("signal_strength" >= 0) AND ("signal_strength" <= 31)))
);


ALTER TABLE "public"."gprs_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gprs_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" character varying(100) NOT NULL,
    "meter_id" "uuid",
    "task_type" character varying(50) NOT NULL,
    "command_payload" "jsonb",
    "status" character varying(50) DEFAULT 'pending'::character varying,
    "result_payload" "jsonb",
    "executed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."gprs_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."interviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "interview_type" character varying(50),
    "scheduled_date" timestamp with time zone,
    "interviewer_id" "uuid",
    "location" "text",
    "status" character varying(20) DEFAULT 'scheduled'::character varying,
    "feedback" "text",
    "rating" numeric(3,1),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."interviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."interviews" IS 'HR recruitment system - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."job_postings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" character varying(200) NOT NULL,
    "department" character varying(100),
    "job_type" character varying(50),
    "location" character varying(100),
    "description" "text" NOT NULL,
    "requirements" "text",
    "salary_range_min" numeric(10,2),
    "salary_range_max" numeric(10,2),
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "posted_by" "uuid",
    "posted_at" timestamp with time zone,
    "closing_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."job_postings" OWNER TO "postgres";


COMMENT ON TABLE "public"."job_postings" IS 'HR recruitment system - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."leave_approvals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "leave_request_id" "uuid" NOT NULL,
    "approver_id" "uuid" NOT NULL,
    "approval_level" integer NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "comments" "text",
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."leave_approvals" OWNER TO "postgres";


COMMENT ON TABLE "public"."leave_approvals" IS 'HR leave management - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."leave_balances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "leave_type_id" "uuid" NOT NULL,
    "year" integer NOT NULL,
    "allocated_days" integer DEFAULT 0 NOT NULL,
    "used_days" integer DEFAULT 0 NOT NULL,
    "carry_forward_days" integer DEFAULT 0,
    "balance_days" integer GENERATED ALWAYS AS ((("allocated_days" + "carry_forward_days") - "used_days")) STORED,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."leave_balances" OWNER TO "postgres";


COMMENT ON TABLE "public"."leave_balances" IS 'HR leave management - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."leave_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "leave_type_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "days_count" integer NOT NULL,
    "reason" "text" NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "rejected_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."leave_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."leave_requests" IS 'Requests for leave';



CREATE TABLE IF NOT EXISTS "public"."leave_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "code" character varying(20) NOT NULL,
    "max_days" integer NOT NULL,
    "is_paid" boolean DEFAULT true,
    "carry_forward" boolean DEFAULT false,
    "requires_approval" boolean DEFAULT true,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."leave_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meter_readings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meter_id" "uuid",
    "odyssey_meter_id" "text",
    "reading_value" numeric(12,2) NOT NULL,
    "reading_type" "text" DEFAULT 'hourly'::"text",
    "timestamp" timestamp with time zone NOT NULL,
    "voltage" numeric(8,2),
    "current" numeric(8,2),
    "active_power" numeric(10,2),
    "reactive_power" numeric(10,2),
    "power_factor" numeric(4,2),
    "frequency" numeric(5,2),
    "consumption" numeric(10,2),
    "demand" numeric(10,2),
    "voltage_phase_a" numeric(8,2),
    "voltage_phase_b" numeric(8,2),
    "voltage_phase_c" numeric(8,2),
    "current_phase_a" numeric(8,2),
    "current_phase_b" numeric(8,2),
    "current_phase_c" numeric(8,2),
    "source" "text" DEFAULT 'local'::"text",
    "synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "site_id" character varying(50),
    "energy_balance_kwh" numeric,
    "energy_consumption_kwh" numeric,
    "energy_reading_kwh" numeric,
    "time_interval_minutes" integer DEFAULT 60,
    "customer_account_id" "text",
    CONSTRAINT "meter_readings_reading_type_check" CHECK (("reading_type" = ANY (ARRAY['hourly'::"text", 'daily'::"text", 'monthly'::"text", 'instantaneous'::"text"]))),
    CONSTRAINT "meter_readings_source_check" CHECK (("source" = ANY (ARRAY['local'::"text", 'odyssey'::"text", 'migrated'::"text"])))
);


ALTER TABLE "public"."meter_readings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meter_id" character varying(20) NOT NULL,
    "customer_id" "uuid",
    "tariff_id" "uuid",
    "gateway_id" "uuid",
    "meter_type" character varying(50) DEFAULT 'single_phase'::character varying NOT NULL,
    "status" character varying(20) DEFAULT 'online'::character varying,
    "install_date" "date",
    "last_reading" numeric(10,2),
    "last_reading_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "serial_number" "text",
    "meter_model" "text",
    "firmware_version" "text",
    "location" "jsonb",
    "metadata" "jsonb",
    "odyssey_meter_id" "text",
    "last_sync_at" timestamp with time zone,
    "sync_status" "text" DEFAULT 'synced'::"text",
    "phase_type" character varying(20),
    "model_name" character varying(100),
    "last_communication_at" timestamp with time zone,
    "site_id" character varying(50),
    CONSTRAINT "meters_status_check" CHECK ((("status")::"text" = ANY (ARRAY['online'::"text", 'offline'::"text", 'active'::"text", 'inactive'::"text"]))),
    CONSTRAINT "meters_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['synced'::"text", 'pending'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."meters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "user_id" "uuid" NOT NULL,
    "in_app_enabled" boolean DEFAULT true NOT NULL,
    "email_enabled" boolean DEFAULT true NOT NULL,
    "tasks_enabled" boolean DEFAULT true NOT NULL,
    "assets_enabled" boolean DEFAULT true NOT NULL,
    "feedback_enabled" boolean DEFAULT true NOT NULL,
    "approvals_enabled" boolean DEFAULT true NOT NULL,
    "system_enabled" boolean DEFAULT true NOT NULL,
    "mentions_enabled" boolean DEFAULT true NOT NULL,
    "email_frequency" "text" DEFAULT 'immediate'::"text" NOT NULL,
    "quiet_hours_start" time without time zone,
    "quiet_hours_end" time without time zone,
    "auto_mark_read_on_click" boolean DEFAULT true NOT NULL,
    "show_previews" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_preferences_email_frequency_check" CHECK (("email_frequency" = ANY (ARRAY['immediate'::"text", 'hourly'::"text", 'daily'::"text", 'weekly'::"text", 'never'::"text"])))
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


COMMENT ON TABLE "public"."notification_preferences" IS 'User notification settings and preferences';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "read" boolean DEFAULT false,
    "action_url" "text",
    "priority" "text" DEFAULT 'normal'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_at" timestamp with time zone,
    CONSTRAINT "notifications_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['token_generated'::"text", 'token_cancelled'::"text", 'task_completed'::"text", 'task_failed'::"text", 'customer_added'::"text", 'customer_updated'::"text", 'meter_status_change'::"text", 'meter_added'::"text", 'activity_reminder'::"text", 'crm_contact_added'::"text", 'opportunity_won'::"text", 'opportunity_lost'::"text", 'system_alert'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "offer_salary" numeric(10,2) NOT NULL,
    "offer_date" "date" NOT NULL,
    "start_date" "date" NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."offers" OWNER TO "postgres";


COMMENT ON TABLE "public"."offers" IS 'HR recruitment system - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."office_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "department" "text",
    "description" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "site" "text",
    CONSTRAINT "office_locations_type_check" CHECK (("type" = ANY (ARRAY['office'::"text", 'department_office'::"text", 'conference_room'::"text", 'common_area'::"text"])))
);


ALTER TABLE "public"."office_locations" OWNER TO "postgres";


COMMENT ON TABLE "public"."office_locations" IS 'Physical office locations and rooms within the company';



COMMENT ON COLUMN "public"."office_locations"."type" IS 'Type of location: office (executive), department_office, conference_room, or common_area';



COMMENT ON COLUMN "public"."office_locations"."site" IS 'Site location (e.g., Head Office, Branch Office, Remote Site)';



CREATE OR REPLACE VIEW "public"."office_location_usage" WITH ("security_invoker"='true') AS
 SELECT "ol"."name",
    "ol"."type",
    "ol"."department",
    "count"("a"."id") AS "asset_count",
    "ol"."is_active"
   FROM ("public"."office_locations" "ol"
     LEFT JOIN "public"."assets" "a" ON ((("a"."office_location" = "ol"."name") AND ("a"."assignment_type" = 'office'::"text"))))
  GROUP BY "ol"."id", "ol"."name", "ol"."type", "ol"."department", "ol"."is_active"
  ORDER BY ("count"("a"."id")) DESC, "ol"."name";


ALTER VIEW "public"."office_location_usage" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."office_locations_by_type" WITH ("security_invoker"='true') AS
 SELECT "id",
    "name",
    "type",
    "department",
    "description",
    "is_active",
        CASE
            WHEN ("type" = 'department_office'::"text") THEN 'Department Office'::"text"
            WHEN ("type" = 'common_area'::"text") THEN 'Common Area'::"text"
            WHEN ("type" = 'conference_room'::"text") THEN 'Conference Room'::"text"
            WHEN ("type" = 'office'::"text") THEN 'Executive Office'::"text"
            ELSE 'Other'::"text"
        END AS "type_label"
   FROM "public"."office_locations"
  WHERE ("is_active" = true)
  ORDER BY
        CASE "type"
            WHEN 'office'::"text" THEN 1
            WHEN 'department_office'::"text" THEN 2
            WHEN 'conference_room'::"text" THEN 3
            WHEN 'common_area'::"text" THEN 4
            ELSE 5
        END, "department", "name";


ALTER VIEW "public"."office_locations_by_type" OWNER TO "postgres";


COMMENT ON VIEW "public"."office_locations_by_type" IS 'Categorized view of active office locations with type labels';



CREATE TABLE IF NOT EXISTS "public"."overtime_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "hours" numeric(4,2) NOT NULL,
    "reason" "text" NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."overtime_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."overtime_requests" IS 'HR time tracking - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."payment_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payment_categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."payment_categories" IS 'Auto-populated list of payment categories used across the system';



CREATE TABLE IF NOT EXISTS "public"."payment_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size" bigint,
    "mime_type" "text",
    "description" "text",
    "uploaded_by" "uuid",
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "applicable_date" "date",
    "is_archived" boolean DEFAULT false,
    "replaced_by" "uuid",
    "archived_at" timestamp with time zone,
    CONSTRAINT "payment_documents_document_type_check" CHECK (("document_type" = ANY (ARRAY['invoice'::"text", 'receipt'::"text", 'requisition'::"text", 'approval'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."payment_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."payment_documents" IS 'Documents attached to department payments';



CREATE TABLE IF NOT EXISTS "public"."payroll_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payroll_period_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "basic_salary" numeric(10,2) NOT NULL,
    "gross_salary" numeric(10,2) NOT NULL,
    "total_deductions" numeric(10,2) DEFAULT 0,
    "net_salary" numeric(10,2) NOT NULL,
    "tax_amount" numeric(10,2) DEFAULT 0,
    "bonus" numeric(10,2) DEFAULT 0,
    "overtime_pay" numeric(10,2) DEFAULT 0,
    "leave_deduction" numeric(10,2) DEFAULT 0,
    "other_deductions" numeric(10,2) DEFAULT 0,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "payslip_generated" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payroll_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."payroll_entries" IS 'HR payroll system - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."payroll_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "pay_date" "date" NOT NULL,
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "total_amount" numeric(12,2) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payroll_periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payslips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payroll_entry_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "payroll_period_id" "uuid" NOT NULL,
    "payslip_number" character varying(50) NOT NULL,
    "pdf_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payslips" OWNER TO "postgres";


COMMENT ON TABLE "public"."payslips" IS 'HR payroll system - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."pending_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "other_names" "text",
    "department" "text",
    "company_role" "text",
    "phone_number" "text",
    "residential_address" "text",
    "current_work_location" "text",
    "device_allocated" "text",
    "device_type" "text",
    "device_model" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "pending_users_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."pending_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."performance_ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "performance_review_id" "uuid" NOT NULL,
    "criterion" character varying(200) NOT NULL,
    "rating" numeric(3,1) NOT NULL,
    "comments" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."performance_ratings" OWNER TO "postgres";


COMMENT ON TABLE "public"."performance_ratings" IS 'HR performance management - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."performance_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "review_cycle_id" "uuid" NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "review_date" "date" NOT NULL,
    "overall_rating" numeric(3,1),
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "self_review_completed" boolean DEFAULT false,
    "manager_review_completed" boolean DEFAULT false,
    "employee_comments" "text",
    "manager_comments" "text",
    "goals_achieved" integer DEFAULT 0,
    "goals_total" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."performance_reviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."performance_reviews" IS 'HR performance management - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "other_names" "text",
    "department" "text",
    "company_role" "text",
    "company_email" "text",
    "phone_number" "text",
    "additional_phone" "text",
    "residential_address" "text",
    "current_work_location" "text",
    "device_allocated" "text",
    "device_type" "text",
    "device_model" "text",
    "is_admin" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "devices" "jsonb",
    "bank_name" "text",
    "bank_account_number" "text",
    "bank_account_name" "text",
    "date_of_birth" "date",
    "employment_date" "date",
    "role" "public"."user_role" DEFAULT 'employee'::"public"."user_role",
    "is_department_lead" boolean DEFAULT false,
    "lead_departments" "text"[] DEFAULT '{}'::"text"[],
    "job_description" "text",
    "job_description_updated_at" timestamp with time zone,
    "office_location" "text",
    "full_name" "text" GENERATED ALWAYS AS (TRIM(BOTH FROM ((COALESCE("first_name", ''::"text") || ' '::"text") || COALESCE("last_name", ''::"text")))) STORED,
    "department_id" "uuid",
    "employment_status" "public"."employment_status" DEFAULT 'active'::"public"."employment_status",
    "status_changed_at" timestamp with time zone,
    "status_changed_by" "uuid",
    "termination_date" "date",
    "termination_reason" "text",
    "employee_number" "text",
    "email_notifications" boolean DEFAULT false,
    CONSTRAINT "check_lead_has_departments" CHECK ((("role" <> 'lead'::"public"."user_role") OR (("lead_departments" IS NOT NULL) AND ("array_length"("lead_departments", 1) > 0)))),
    CONSTRAINT "profiles_employee_number_format" CHECK ((("employee_number" IS NULL) OR ("employee_number" ~ '^ACOB/[0-9]{4}/[0-9]{3}$'::"text"))),
    CONSTRAINT "profiles_office_location_check" CHECK ((("office_location" IS NULL) OR ("office_location" = ANY (ARRAY['Accounts'::"text", 'Admin & HR'::"text", 'Assistant Executive Director'::"text", 'Business, Growth and Innovation'::"text", 'General Conference Room'::"text", 'IT and Communications'::"text", 'Kitchen'::"text", 'Legal, Regulatory and Compliance'::"text", 'MD Conference Room'::"text", 'MD Office'::"text", 'Operations'::"text", 'Reception'::"text", 'Site'::"text", 'Technical'::"text", 'Technical Extension'::"text"]))))
);

ALTER TABLE ONLY "public"."profiles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."department" IS 'DEPRECATED: Use department_id instead. Kept for backward compatibility.';



COMMENT ON COLUMN "public"."profiles"."device_allocated" IS 'DEPRECATED: Use assets table instead';



COMMENT ON COLUMN "public"."profiles"."device_type" IS 'DEPRECATED: Use assets table instead';



COMMENT ON COLUMN "public"."profiles"."device_model" IS 'DEPRECATED: Use assets table instead';



COMMENT ON COLUMN "public"."profiles"."devices" IS 'DEPRECATED: Use assets table instead';



COMMENT ON COLUMN "public"."profiles"."full_name" IS 'Computed column combining first_name and last_name';



COMMENT ON COLUMN "public"."profiles"."employment_status" IS 'Current employment status: active, suspended, terminated, or on_leave';



COMMENT ON COLUMN "public"."profiles"."status_changed_at" IS 'Timestamp when employment status was last changed';



COMMENT ON COLUMN "public"."profiles"."status_changed_by" IS 'User ID of who changed the employment status';



COMMENT ON COLUMN "public"."profiles"."termination_date" IS 'Date of employment termination (if terminated)';



COMMENT ON COLUMN "public"."profiles"."termination_reason" IS 'Reason for termination (if terminated)';



COMMENT ON COLUMN "public"."profiles"."employee_number" IS 'Unique employee identifier in format: ACOB/{YEAR}/{SERIAL} e.g., ACOB/2026/058. Required for new employees.';



CREATE TABLE IF NOT EXISTS "public"."project_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "description" "text",
    "quantity" integer DEFAULT 1,
    "unit" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "project_items_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'ordered'::"text", 'received'::"text", 'installed'::"text"])))
);


ALTER TABLE "public"."project_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text",
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "removed_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "project_members_role_check" CHECK (("role" = ANY (ARRAY['member'::"text", 'lead'::"text", 'manager'::"text"])))
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "update_type" "text",
    "content" "text",
    "old_value" "text",
    "new_value" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "project_updates_update_type_check" CHECK (("update_type" = ANY (ARRAY['comment'::"text", 'status_change'::"text", 'milestone'::"text", 'member_added'::"text", 'member_removed'::"text"])))
);


ALTER TABLE "public"."project_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_name" "text" NOT NULL,
    "location" "text" NOT NULL,
    "deployment_start_date" "date" NOT NULL,
    "deployment_end_date" "date" NOT NULL,
    "capacity_w" numeric,
    "technology_type" "text",
    "project_manager_id" "uuid",
    "description" "text",
    "status" "text" DEFAULT 'planning'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['planning'::"text", 'active'::"text", 'on_hold'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."remote_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meter_id" "uuid",
    "task_type" character varying(20) NOT NULL,
    "operation" character varying(20),
    "parameters" "jsonb",
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "result" "jsonb",
    "error_message" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "task_id" "text",
    "odyssey_task_id" "text",
    "estimated_completion" timestamp with time zone,
    "retry_count" integer DEFAULT 0,
    "last_retry_at" timestamp with time zone,
    CONSTRAINT "remote_tasks_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::"text"[]))),
    CONSTRAINT "remote_tasks_task_type_check" CHECK ((("task_type")::"text" = ANY ((ARRAY['token'::character varying, 'control'::character varying, 'reading'::character varying])::"text"[])))
);


ALTER TABLE "public"."remote_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_cycles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "review_type" character varying(50) NOT NULL,
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."review_cycles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "permissions" "text"[] DEFAULT '{}'::"text"[],
    "is_system" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salary_components" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "code" character varying(20) NOT NULL,
    "type" character varying(20) NOT NULL,
    "is_taxable" boolean DEFAULT true,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."salary_components" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salary_structures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_salary_id" "uuid" NOT NULL,
    "salary_component_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "percentage" numeric(5,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."salary_structures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "department" character varying(100),
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."shifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."starlink_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_size" bigint,
    "mime_type" "text",
    "description" "text",
    "uploaded_by" "uuid",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "starlink_documents_document_type_check" CHECK (("document_type" = ANY (ARRAY['invoice'::"text", 'receipt'::"text", 'requisition'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."starlink_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."starlink_documents" IS 'Stores documents related to Starlink payments (invoices, receipts, requisitions)';



CREATE TABLE IF NOT EXISTS "public"."starlink_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "billing_period_start" "date" NOT NULL,
    "billing_period_end" "date" NOT NULL,
    "next_payment_due" "date" NOT NULL,
    "amount" numeric(10,2),
    "currency" "text" DEFAULT 'NGN'::"text",
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "payment_date" "date",
    "payment_reference" "text",
    "reminder_sent" boolean DEFAULT false NOT NULL,
    "reminder_sent_at" timestamp with time zone,
    "requisition_raised" boolean DEFAULT false NOT NULL,
    "requisition_raised_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "starlink_payments_dates_check" CHECK (("billing_period_end" > "billing_period_start")),
    CONSTRAINT "starlink_payments_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'overdue'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."starlink_payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."starlink_payments" IS 'Tracks Starlink payment schedules and statuses';



CREATE TABLE IF NOT EXISTS "public"."starlink_sites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "state" "text" NOT NULL,
    "site_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone_number" "text" NOT NULL,
    "serial_number" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "migrated_to_department_payments" boolean DEFAULT false,
    CONSTRAINT "starlink_sites_email_check" CHECK (("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text"))
);


ALTER TABLE "public"."starlink_sites" OWNER TO "postgres";


COMMENT ON TABLE "public"."starlink_sites" IS 'Stores information about Starlink installation sites';



CREATE TABLE IF NOT EXISTS "public"."sync_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sync_type" "text" NOT NULL,
    "last_sync_at" timestamp with time zone NOT NULL,
    "last_sync_from" timestamp with time zone,
    "last_sync_to" timestamp with time zone,
    "records_synced" integer DEFAULT 0,
    "status" "text" DEFAULT 'success'::"text",
    "error_message" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sync_state_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'partial'::"text", 'failed'::"text"]))),
    CONSTRAINT "sync_state_sync_type_check" CHECK (("sync_type" = ANY (ARRAY['tokens'::"text", 'readings'::"text", 'tasks'::"text", 'events'::"text", 'gprs_status'::"text"])))
);


ALTER TABLE "public"."sync_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid"
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tariffs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tariff_id" character varying(20) NOT NULL,
    "name" character varying(100) NOT NULL,
    "category" character varying(20),
    "price_per_kwh" numeric(10,2) NOT NULL,
    "vat_rate" numeric(5,2) DEFAULT 7.5,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tariffs_category_check" CHECK ((("category")::"text" = ANY ((ARRAY['RESIDENTIAL'::character varying, 'COMMERCIAL'::character varying, 'PRODUCTIVE'::character varying, 'PUBLIC'::character varying])::"text"[])))
);


ALTER TABLE "public"."tariffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid",
    "user_id" "uuid",
    "update_type" "text",
    "content" "text",
    "old_value" "text",
    "new_value" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_user_completion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_user_completion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "priority" "text" DEFAULT 'medium'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "assigned_to" "uuid",
    "assigned_by" "uuid",
    "department" "text",
    "due_date" "date",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "progress" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "assignment_type" "text" DEFAULT 'individual'::"text",
    "project_id" "uuid",
    "task_start_date" "date",
    "task_end_date" "date",
    "category" "text" DEFAULT 'general'::"text",
    "week_number" integer,
    "year" integer,
    CONSTRAINT "tasks_assignment_type_check" CHECK (("assignment_type" = ANY (ARRAY['individual'::"text", 'multiple'::"text", 'department'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timesheets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_start_date" "date" NOT NULL,
    "week_end_date" "date" NOT NULL,
    "total_hours" numeric(6,2) DEFAULT 0,
    "overtime_hours" numeric(6,2) DEFAULT 0,
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."timesheets" OWNER TO "postgres";


COMMENT ON TABLE "public"."timesheets" IS 'HR time tracking - Currently unused, admin-only access';



CREATE TABLE IF NOT EXISTS "public"."token_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "meter_id" "uuid",
    "token_type" character varying(20) NOT NULL,
    "token" character varying(50) NOT NULL,
    "amount" numeric(10,2),
    "units" numeric(10,2),
    "power_limit" numeric(10,2),
    "status" character varying(20) DEFAULT 'active'::character varying,
    "generated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "receipt_id" "text",
    "tariff_rate" numeric(10,2),
    "vat_amount" numeric(10,2),
    "total_amount" numeric(10,2),
    "used_at" timestamp with time zone,
    "source" "text" DEFAULT 'local'::"text",
    "odyssey_token_id" "text",
    "synced_at" timestamp with time zone,
    "generated_at" timestamp with time zone DEFAULT "now"(),
    "odyssey_data" "jsonb",
    "currency" "text" DEFAULT 'NAIRA'::"text",
    "transaction_type" "text",
    "odyssey_meter_id" "text",
    "odyssey_customer_id" "text",
    "serial_number" "text",
    "site_id" character varying(50),
    CONSTRAINT "token_records_source_check" CHECK (("source" = ANY (ARRAY['local'::"text", 'odyssey'::"text", 'migrated'::"text"]))),
    CONSTRAINT "token_records_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'cancelled'::character varying, 'expired'::character varying])::"text"[]))),
    CONSTRAINT "token_records_token_type_check" CHECK ((("token_type")::"text" = ANY ((ARRAY['credit'::character varying, 'clear_tamper'::character varying, 'clear_credit'::character varying, 'max_power'::character varying])::"text"[])))
);


ALTER TABLE "public"."token_records" OWNER TO "postgres";


COMMENT ON COLUMN "public"."token_records"."odyssey_token_id" IS 'Unique identifier from Odyssey API - prevents duplicates';



COMMENT ON COLUMN "public"."token_records"."odyssey_data" IS 'Full Odyssey API response for verbatim data storage';



CREATE TABLE IF NOT EXISTS "public"."token_sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "meter_id" "uuid",
    "token" character varying(50) NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "units" numeric(10,2) NOT NULL,
    "vat" numeric(10,2),
    "total_amount" numeric(10,2),
    "tariff_rate" numeric(10,2),
    "status" character varying(20) DEFAULT 'active'::character varying,
    "generated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "token_sales_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'cancelled'::character varying, 'expired'::character varying])::"text"[])))
);


ALTER TABLE "public"."token_sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_documentation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "category" "text",
    "tags" "text"[],
    "is_draft" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_documentation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "role" character varying(20) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_roles_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['super_admin'::character varying, 'admin'::character varying, 'lead'::character varying, 'employee'::character varying, 'visitor'::character varying])::"text"[])))
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_active_tasks_summary" WITH ("security_invoker"='true') AS
 SELECT "task_type",
    "status",
    "count"(*) AS "task_count",
    "min"("created_at") AS "oldest_task",
    "max"("created_at") AS "newest_task"
   FROM "public"."remote_tasks"
  WHERE (("status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying])::"text"[]))
  GROUP BY "task_type", "status";


ALTER VIEW "public"."v_active_tasks_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_customer_token_stats" WITH ("security_invoker"='true') AS
 SELECT "c"."id" AS "customer_id",
    "c"."customer_id" AS "customer_number",
    "c"."name" AS "customer_name",
    "count"("tr"."id") AS "total_tokens",
    "sum"("tr"."amount") AS "total_amount",
    "sum"("tr"."units") AS "total_units",
    "max"("tr"."generated_at") AS "last_purchase_date",
    "count"(
        CASE
            WHEN ("tr"."generated_at" > ("now"() - '30 days'::interval)) THEN 1
            ELSE NULL::integer
        END) AS "tokens_last_30_days"
   FROM ("public"."customers" "c"
     LEFT JOIN "public"."token_records" "tr" ON (("c"."id" = "tr"."customer_id")))
  GROUP BY "c"."id", "c"."customer_id", "c"."name";


ALTER VIEW "public"."v_customer_token_stats" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_latest_meter_readings" WITH ("security_invoker"='true') AS
 SELECT "m"."id" AS "meter_id",
    "m"."meter_id" AS "meter_number",
    "m"."meter_type",
    "c"."name" AS "customer_name",
    "mr"."reading_value",
    "mr"."timestamp" AS "reading_time",
    "mr"."consumption",
    "mr"."voltage",
    "mr"."current",
    "mr"."power_factor",
    "mr"."source"
   FROM (("public"."meters" "m"
     LEFT JOIN LATERAL ( SELECT "meter_readings"."id",
            "meter_readings"."meter_id",
            "meter_readings"."odyssey_meter_id",
            "meter_readings"."reading_value",
            "meter_readings"."reading_type",
            "meter_readings"."timestamp",
            "meter_readings"."voltage",
            "meter_readings"."current",
            "meter_readings"."active_power",
            "meter_readings"."reactive_power",
            "meter_readings"."power_factor",
            "meter_readings"."frequency",
            "meter_readings"."consumption",
            "meter_readings"."demand",
            "meter_readings"."voltage_phase_a",
            "meter_readings"."voltage_phase_b",
            "meter_readings"."voltage_phase_c",
            "meter_readings"."current_phase_a",
            "meter_readings"."current_phase_b",
            "meter_readings"."current_phase_c",
            "meter_readings"."source",
            "meter_readings"."synced_at",
            "meter_readings"."created_at"
           FROM "public"."meter_readings"
          WHERE ("meter_readings"."meter_id" = "m"."id")
          ORDER BY "meter_readings"."timestamp" DESC
         LIMIT 1) "mr" ON (true))
     LEFT JOIN "public"."customers" "c" ON (("m"."customer_id" = "c"."id")));


ALTER VIEW "public"."v_latest_meter_readings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_dashboard_stats" WITH ("security_invoker"='true') AS
 SELECT ( SELECT "count"(*) AS "count"
           FROM "public"."meters"
          WHERE (("meters"."status")::"text" = 'active'::"text")) AS "active_meters",
    ( SELECT "count"(*) AS "count"
           FROM "public"."customers") AS "total_customers",
    ( SELECT COALESCE("sum"("token_records"."amount"), (0)::numeric) AS "coalesce"
           FROM "public"."token_records"
          WHERE ("token_records"."created_at" > CURRENT_DATE)) AS "revenue_today",
    ( SELECT COALESCE("sum"("token_records"."units"), (0)::numeric) AS "coalesce"
           FROM "public"."token_records"
          WHERE ("token_records"."created_at" > CURRENT_DATE)) AS "units_sold_today";


ALTER VIEW "public"."view_dashboard_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "department" "text" NOT NULL,
    "week_number" integer NOT NULL,
    "year" integer NOT NULL,
    "work_done" "text",
    "tasks_new_week" "text",
    "challenges" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "weekly_reports_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text"])))
);


ALTER TABLE "public"."weekly_reports" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_logs"
    ADD CONSTRAINT "admin_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_assignments"
    ADD CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_issues"
    ADD CONSTRAINT "asset_issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_types"
    ADD CONSTRAINT "asset_types_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."asset_types"
    ADD CONSTRAINT "asset_types_label_key" UNIQUE ("label");



ALTER TABLE ONLY "public"."asset_types"
    ADD CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_serial_number_key" UNIQUE ("serial_number");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_unique_code_key" UNIQUE ("unique_code");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consumption_data"
    ADD CONSTRAINT "consumption_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_contacts"
    ADD CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_pipelines"
    ADD CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_tags"
    ADD CONSTRAINT "crm_tags_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."crm_tags"
    ADD CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_customer_id_key" UNIQUE ("customer_id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_external_id_key" UNIQUE ("external_id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_payments"
    ADD CONSTRAINT "department_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_salaries"
    ADD CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_suspensions"
    ADD CONSTRAINT "employee_suspensions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_notifications"
    ADD CONSTRAINT "event_notifications_event_id_key" UNIQUE ("event_id");



ALTER TABLE ONLY "public"."event_notifications"
    ADD CONSTRAINT "event_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."firmware_tasks"
    ADD CONSTRAINT "firmware_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."firmware_updates"
    ADD CONSTRAINT "firmware_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gateways"
    ADD CONSTRAINT "gateways_gateway_id_key" UNIQUE ("gateway_id");



ALTER TABLE ONLY "public"."gateways"
    ADD CONSTRAINT "gateways_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goals_objectives"
    ADD CONSTRAINT "goals_objectives_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gprs_status"
    ADD CONSTRAINT "gprs_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gprs_tasks"
    ADD CONSTRAINT "gprs_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gprs_tasks"
    ADD CONSTRAINT "gprs_tasks_task_id_key" UNIQUE ("task_id");



ALTER TABLE ONLY "public"."interviews"
    ADD CONSTRAINT "interviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_postings"
    ADD CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_approvals"
    ADD CONSTRAINT "leave_approvals_leave_request_id_approver_id_approval_level_key" UNIQUE ("leave_request_id", "approver_id", "approval_level");



ALTER TABLE ONLY "public"."leave_approvals"
    ADD CONSTRAINT "leave_approvals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_user_id_leave_type_id_year_key" UNIQUE ("user_id", "leave_type_id", "year");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."leave_types"
    ADD CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meter_readings"
    ADD CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meters"
    ADD CONSTRAINT "meters_meter_id_key" UNIQUE ("meter_id");



ALTER TABLE ONLY "public"."meters"
    ADD CONSTRAINT "meters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offers"
    ADD CONSTRAINT "offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."office_locations"
    ADD CONSTRAINT "office_locations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."office_locations"
    ADD CONSTRAINT "office_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."overtime_requests"
    ADD CONSTRAINT "overtime_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_categories"
    ADD CONSTRAINT "payment_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."payment_categories"
    ADD CONSTRAINT "payment_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_documents"
    ADD CONSTRAINT "payment_documents_file_path_key" UNIQUE ("file_path");



ALTER TABLE ONLY "public"."payment_documents"
    ADD CONSTRAINT "payment_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_entries"
    ADD CONSTRAINT "payroll_entries_payroll_period_id_user_id_key" UNIQUE ("payroll_period_id", "user_id");



ALTER TABLE ONLY "public"."payroll_entries"
    ADD CONSTRAINT "payroll_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_periods"
    ADD CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payroll_periods"
    ADD CONSTRAINT "payroll_periods_start_date_end_date_key" UNIQUE ("start_date", "end_date");



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_payslip_number_key" UNIQUE ("payslip_number");



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_users"
    ADD CONSTRAINT "pending_users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."pending_users"
    ADD CONSTRAINT "pending_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."performance_ratings"
    ADD CONSTRAINT "performance_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_user_id_review_cycle_id_reviewer_id_key" UNIQUE ("user_id", "review_cycle_id", "reviewer_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_employee_number_key" UNIQUE ("employee_number");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_items"
    ADD CONSTRAINT "project_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_user_id_is_active_key" UNIQUE ("project_id", "user_id", "is_active");



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."remote_tasks"
    ADD CONSTRAINT "remote_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."remote_tasks"
    ADD CONSTRAINT "remote_tasks_task_id_key" UNIQUE ("task_id");



ALTER TABLE ONLY "public"."review_cycles"
    ADD CONSTRAINT "review_cycles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salary_components"
    ADD CONSTRAINT "salary_components_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."salary_components"
    ADD CONSTRAINT "salary_components_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."salary_components"
    ADD CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salary_structures"
    ADD CONSTRAINT "salary_structures_employee_salary_id_salary_component_id_key" UNIQUE ("employee_salary_id", "salary_component_id");



ALTER TABLE ONLY "public"."salary_structures"
    ADD CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."starlink_documents"
    ADD CONSTRAINT "starlink_documents_file_path_unique" UNIQUE ("file_path");



ALTER TABLE ONLY "public"."starlink_documents"
    ADD CONSTRAINT "starlink_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."starlink_payments"
    ADD CONSTRAINT "starlink_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."starlink_payments"
    ADD CONSTRAINT "starlink_payments_unique_invoice" UNIQUE ("site_id", "invoice_number");



ALTER TABLE ONLY "public"."starlink_sites"
    ADD CONSTRAINT "starlink_sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."starlink_sites"
    ADD CONSTRAINT "starlink_sites_serial_number_key" UNIQUE ("serial_number");



ALTER TABLE ONLY "public"."sync_state"
    ADD CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."tariffs"
    ADD CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tariffs"
    ADD CONSTRAINT "tariffs_tariff_id_key" UNIQUE ("tariff_id");



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_task_id_user_id_key" UNIQUE ("task_id", "user_id");



ALTER TABLE ONLY "public"."task_updates"
    ADD CONSTRAINT "task_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_user_completion"
    ADD CONSTRAINT "task_user_completion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_user_completion"
    ADD CONSTRAINT "task_user_completion_task_id_user_id_key" UNIQUE ("task_id", "user_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timesheets"
    ADD CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timesheets"
    ADD CONSTRAINT "timesheets_user_id_week_start_date_key" UNIQUE ("user_id", "week_start_date");



ALTER TABLE ONLY "public"."token_records"
    ADD CONSTRAINT "token_records_odyssey_token_id_key" UNIQUE ("odyssey_token_id");



COMMENT ON CONSTRAINT "token_records_odyssey_token_id_key" ON "public"."token_records" IS 'Prevents duplicate records from Odyssey sync';



ALTER TABLE ONLY "public"."token_records"
    ADD CONSTRAINT "token_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_sales"
    ADD CONSTRAINT "token_sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_documentation"
    ADD CONSTRAINT "user_documentation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."weekly_reports"
    ADD CONSTRAINT "weekly_reports_department_week_number_year_key" UNIQUE ("department", "week_number", "year");



ALTER TABLE ONLY "public"."weekly_reports"
    ADD CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_admin_logs_admin_id" ON "public"."admin_logs" USING "btree" ("admin_id");



CREATE INDEX "idx_admin_logs_target_user_id" ON "public"."admin_logs" USING "btree" ("target_user_id");



CREATE INDEX "idx_applications_job" ON "public"."applications" USING "btree" ("job_posting_id");



CREATE INDEX "idx_applications_status" ON "public"."applications" USING "btree" ("status");



CREATE INDEX "idx_asset_assignments_asset_id" ON "public"."asset_assignments" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_assignments_assigned_by" ON "public"."asset_assignments" USING "btree" ("assigned_by");



CREATE INDEX "idx_asset_assignments_assigned_from" ON "public"."asset_assignments" USING "btree" ("assigned_from");



CREATE INDEX "idx_asset_assignments_assigned_to" ON "public"."asset_assignments" USING "btree" ("assigned_to");



CREATE INDEX "idx_asset_assignments_department" ON "public"."asset_assignments" USING "btree" ("department");



CREATE INDEX "idx_asset_assignments_is_current" ON "public"."asset_assignments" USING "btree" ("is_current");



CREATE INDEX "idx_asset_assignments_office_location" ON "public"."asset_assignments" USING "btree" ("office_location");



CREATE INDEX "idx_asset_issues_asset_id" ON "public"."asset_issues" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_issues_created_at" ON "public"."asset_issues" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_asset_issues_created_by" ON "public"."asset_issues" USING "btree" ("created_by");



CREATE INDEX "idx_asset_issues_resolved" ON "public"."asset_issues" USING "btree" ("resolved");



CREATE INDEX "idx_asset_issues_resolved_by" ON "public"."asset_issues" USING "btree" ("resolved_by");



CREATE INDEX "idx_asset_types_code" ON "public"."asset_types" USING "btree" ("code");



CREATE INDEX "idx_asset_types_created_by" ON "public"."asset_types" USING "btree" ("created_by");



CREATE INDEX "idx_asset_types_label" ON "public"."asset_types" USING "btree" ("label");



CREATE INDEX "idx_assets_acquisition_year" ON "public"."assets" USING "btree" ("acquisition_year");



CREATE INDEX "idx_assets_assignment_type" ON "public"."assets" USING "btree" ("assignment_type");



CREATE INDEX "idx_assets_created_by" ON "public"."assets" USING "btree" ("created_by");



CREATE INDEX "idx_assets_department" ON "public"."assets" USING "btree" ("department");



CREATE INDEX "idx_assets_office_location" ON "public"."assets" USING "btree" ("office_location");



CREATE INDEX "idx_assets_status" ON "public"."assets" USING "btree" ("status");



CREATE INDEX "idx_assets_type" ON "public"."assets" USING "btree" ("asset_type");



CREATE INDEX "idx_assets_unique_code" ON "public"."assets" USING "btree" ("unique_code");



CREATE INDEX "idx_attendance_records_shift_id" ON "public"."attendance_records" USING "btree" ("shift_id");



CREATE INDEX "idx_attendance_user_date" ON "public"."attendance_records" USING "btree" ("user_id", "date");



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action");



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_dashboard" ON "public"."audit_logs" USING "btree" ("created_at" DESC, "entity_type", "action");



CREATE INDEX "idx_audit_logs_department" ON "public"."audit_logs" USING "btree" ("department");



CREATE INDEX "idx_audit_logs_entity_type" ON "public"."audit_logs" USING "btree" ("entity_type");



CREATE INDEX "idx_audit_logs_operation" ON "public"."audit_logs" USING "btree" ("operation");



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_consumption_data_meter_id" ON "public"."consumption_data" USING "btree" ("meter_id");



CREATE INDEX "idx_consumption_data_reading_date" ON "public"."consumption_data" USING "btree" ("reading_date" DESC);



CREATE INDEX "idx_crm_activities_assigned_to" ON "public"."crm_activities" USING "btree" ("assigned_to");



CREATE INDEX "idx_crm_activities_completed" ON "public"."crm_activities" USING "btree" ("completed");



CREATE INDEX "idx_crm_activities_contact_id" ON "public"."crm_activities" USING "btree" ("contact_id");



CREATE INDEX "idx_crm_activities_due_date" ON "public"."crm_activities" USING "btree" ("due_date");



CREATE INDEX "idx_crm_activities_opportunity_id" ON "public"."crm_activities" USING "btree" ("opportunity_id");



CREATE INDEX "idx_crm_activities_type" ON "public"."crm_activities" USING "btree" ("type");



CREATE INDEX "idx_crm_contacts_assigned_to" ON "public"."crm_contacts" USING "btree" ("assigned_to");



CREATE INDEX "idx_crm_contacts_created_at" ON "public"."crm_contacts" USING "btree" ("created_at");



CREATE INDEX "idx_crm_contacts_meter_customer_id" ON "public"."crm_contacts" USING "btree" ("meter_customer_id");



CREATE INDEX "idx_crm_contacts_pipeline_id" ON "public"."crm_contacts" USING "btree" ("pipeline_id");



CREATE INDEX "idx_crm_contacts_stage" ON "public"."crm_contacts" USING "btree" ("stage");



CREATE INDEX "idx_crm_contacts_tags" ON "public"."crm_contacts" USING "gin" ("tags");



CREATE INDEX "idx_crm_contacts_type" ON "public"."crm_contacts" USING "btree" ("type");



CREATE INDEX "idx_crm_opportunities_assigned_to" ON "public"."crm_opportunities" USING "btree" ("assigned_to");



CREATE INDEX "idx_crm_opportunities_contact_id" ON "public"."crm_opportunities" USING "btree" ("contact_id");



CREATE INDEX "idx_crm_opportunities_created_at" ON "public"."crm_opportunities" USING "btree" ("created_at");



CREATE INDEX "idx_crm_opportunities_pipeline_id" ON "public"."crm_opportunities" USING "btree" ("pipeline_id");



CREATE INDEX "idx_crm_opportunities_stage" ON "public"."crm_opportunities" USING "btree" ("stage");



CREATE INDEX "idx_crm_opportunities_status" ON "public"."crm_opportunities" USING "btree" ("status");



CREATE INDEX "idx_customers_crm_contact_id" ON "public"."customers" USING "btree" ("crm_contact_id");



CREATE INDEX "idx_customers_customer_id" ON "public"."customers" USING "btree" ("customer_id");



CREATE INDEX "idx_customers_email" ON "public"."customers" USING "btree" ("email");



CREATE INDEX "idx_customers_site_id" ON "public"."customers" USING "btree" ("site_id");



CREATE INDEX "idx_department_payments_invoice_number" ON "public"."department_payments" USING "btree" ("invoice_number");



CREATE INDEX "idx_department_payments_site_id" ON "public"."department_payments" USING "btree" ("site_id");



CREATE INDEX "idx_departments_active" ON "public"."departments" USING "btree" ("is_active");



CREATE INDEX "idx_departments_head_id" ON "public"."departments" USING "btree" ("department_head_id");



CREATE INDEX "idx_departments_name" ON "public"."departments" USING "btree" ("name");



CREATE INDEX "idx_dept_payments_category" ON "public"."department_payments" USING "btree" ("category");



CREATE INDEX "idx_dept_payments_created_by" ON "public"."department_payments" USING "btree" ("created_by");



CREATE INDEX "idx_dept_payments_department" ON "public"."department_payments" USING "btree" ("department_id");



CREATE INDEX "idx_dept_payments_next_due" ON "public"."department_payments" USING "btree" ("next_payment_due");



CREATE INDEX "idx_dept_payments_status" ON "public"."department_payments" USING "btree" ("status");



CREATE INDEX "idx_dept_payments_type" ON "public"."department_payments" USING "btree" ("payment_type");



CREATE INDEX "idx_employee_salaries_user_id" ON "public"."employee_salaries" USING "btree" ("user_id");



CREATE INDEX "idx_employee_suspensions_employee_id" ON "public"."employee_suspensions" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_suspensions_is_active" ON "public"."employee_suspensions" USING "btree" ("is_active");



CREATE INDEX "idx_employee_suspensions_lifted_by" ON "public"."employee_suspensions" USING "btree" ("lifted_by");



CREATE INDEX "idx_employee_suspensions_suspended_by" ON "public"."employee_suspensions" USING "btree" ("suspended_by");



CREATE INDEX "idx_event_notifications_acknowledged_by" ON "public"."event_notifications" USING "btree" ("acknowledged_by");



CREATE INDEX "idx_event_notifications_site_id" ON "public"."event_notifications" USING "btree" ("site_id");



CREATE INDEX "idx_events_acknowledged" ON "public"."event_notifications" USING "btree" ("acknowledged");



CREATE INDEX "idx_events_meter_id" ON "public"."event_notifications" USING "btree" ("meter_id");



CREATE INDEX "idx_events_severity" ON "public"."event_notifications" USING "btree" ("severity");



CREATE INDEX "idx_events_timestamp" ON "public"."event_notifications" USING "btree" ("timestamp" DESC);



CREATE INDEX "idx_feedback_user_id" ON "public"."feedback" USING "btree" ("user_id");



CREATE INDEX "idx_firmware_tasks_firmware_id" ON "public"."firmware_tasks" USING "btree" ("firmware_id");



CREATE INDEX "idx_firmware_tasks_meter_id" ON "public"."firmware_tasks" USING "btree" ("meter_id");



CREATE INDEX "idx_goals_objectives_cycle_id" ON "public"."goals_objectives" USING "btree" ("review_cycle_id");



CREATE INDEX "idx_goals_objectives_user_id" ON "public"."goals_objectives" USING "btree" ("user_id");



CREATE INDEX "idx_gprs_status_last_seen" ON "public"."gprs_status" USING "btree" ("last_seen" DESC);



CREATE INDEX "idx_gprs_status_meter_id" ON "public"."gprs_status" USING "btree" ("meter_id");



CREATE INDEX "idx_gprs_status_online" ON "public"."gprs_status" USING "btree" ("is_online");



CREATE INDEX "idx_gprs_tasks_meter_id" ON "public"."gprs_tasks" USING "btree" ("meter_id");



CREATE INDEX "idx_interviews_app_id" ON "public"."interviews" USING "btree" ("application_id");



CREATE INDEX "idx_interviews_interviewer_id" ON "public"."interviews" USING "btree" ("interviewer_id");



CREATE INDEX "idx_job_postings_posted_by" ON "public"."job_postings" USING "btree" ("posted_by");



CREATE INDEX "idx_leave_approvals_appr_id" ON "public"."leave_approvals" USING "btree" ("approver_id");



CREATE INDEX "idx_leave_balances_type_id" ON "public"."leave_balances" USING "btree" ("leave_type_id");



CREATE INDEX "idx_leave_requests_approved_by" ON "public"."leave_requests" USING "btree" ("approved_by");



CREATE INDEX "idx_leave_requests_status" ON "public"."leave_requests" USING "btree" ("status");



CREATE INDEX "idx_leave_requests_type_id" ON "public"."leave_requests" USING "btree" ("leave_type_id");



CREATE INDEX "idx_leave_requests_user" ON "public"."leave_requests" USING "btree" ("user_id");



CREATE INDEX "idx_meter_readings_meter_id" ON "public"."meter_readings" USING "btree" ("meter_id");



CREATE INDEX "idx_meter_readings_meter_time" ON "public"."meter_readings" USING "btree" ("meter_id", "timestamp" DESC);



CREATE UNIQUE INDEX "idx_meter_readings_odyssey_unique" ON "public"."meter_readings" USING "btree" ("odyssey_meter_id", "timestamp", "site_id") WHERE ("odyssey_meter_id" IS NOT NULL);



CREATE INDEX "idx_meter_readings_site_id" ON "public"."meter_readings" USING "btree" ("site_id");



CREATE INDEX "idx_meter_readings_timestamp" ON "public"."meter_readings" USING "btree" ("timestamp" DESC);



CREATE INDEX "idx_meter_readings_type" ON "public"."meter_readings" USING "btree" ("reading_type");



CREATE INDEX "idx_meters_customer_id" ON "public"."meters" USING "btree" ("customer_id");



CREATE INDEX "idx_meters_gateway_id" ON "public"."meters" USING "btree" ("gateway_id");



CREATE INDEX "idx_meters_meter_id" ON "public"."meters" USING "btree" ("meter_id");



CREATE INDEX "idx_meters_odyssey_id" ON "public"."meters" USING "btree" ("odyssey_meter_id");



CREATE INDEX "idx_meters_site_id" ON "public"."meters" USING "btree" ("site_id");



CREATE INDEX "idx_meters_status" ON "public"."meters" USING "btree" ("status");



CREATE INDEX "idx_meters_tariff_id" ON "public"."meters" USING "btree" ("tariff_id");



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_priority" ON "public"."notifications" USING "btree" ("priority");



CREATE INDEX "idx_notifications_read" ON "public"."notifications" USING "btree" ("read");



CREATE INDEX "idx_notifications_type" ON "public"."notifications" USING "btree" ("type");



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_offers_app_id" ON "public"."offers" USING "btree" ("application_id");



CREATE INDEX "idx_office_locations_department" ON "public"."office_locations" USING "btree" ("department");



CREATE INDEX "idx_office_locations_site" ON "public"."office_locations" USING "btree" ("site");



CREATE INDEX "idx_office_locations_type" ON "public"."office_locations" USING "btree" ("type");



CREATE INDEX "idx_overtime_requests_approved_by" ON "public"."overtime_requests" USING "btree" ("approved_by");



CREATE INDEX "idx_overtime_requests_user_id" ON "public"."overtime_requests" USING "btree" ("user_id");



CREATE INDEX "idx_payment_docs_payment" ON "public"."payment_documents" USING "btree" ("payment_id");



CREATE INDEX "idx_payment_docs_replaced_by" ON "public"."payment_documents" USING "btree" ("replaced_by");



CREATE INDEX "idx_payment_docs_uploaded_by" ON "public"."payment_documents" USING "btree" ("uploaded_by");



CREATE INDEX "idx_payment_documents_archived" ON "public"."payment_documents" USING "btree" ("is_archived");



CREATE INDEX "idx_payment_documents_date" ON "public"."payment_documents" USING "btree" ("applicable_date");



CREATE INDEX "idx_payroll_entries_period" ON "public"."payroll_entries" USING "btree" ("payroll_period_id");



CREATE INDEX "idx_payroll_entries_user" ON "public"."payroll_entries" USING "btree" ("user_id");



CREATE INDEX "idx_payslips_entry_id" ON "public"."payslips" USING "btree" ("payroll_entry_id");



CREATE INDEX "idx_payslips_period_id" ON "public"."payslips" USING "btree" ("payroll_period_id");



CREATE INDEX "idx_payslips_user_id" ON "public"."payslips" USING "btree" ("user_id");



CREATE INDEX "idx_perf_reviews_cycle_id" ON "public"."performance_reviews" USING "btree" ("review_cycle_id");



CREATE INDEX "idx_perf_reviews_reviewer_id" ON "public"."performance_reviews" USING "btree" ("reviewer_id");



CREATE INDEX "idx_performance_ratings_review_id" ON "public"."performance_ratings" USING "btree" ("performance_review_id");



CREATE INDEX "idx_performance_reviews_user" ON "public"."performance_reviews" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_department_id" ON "public"."profiles" USING "btree" ("department_id");



CREATE INDEX "idx_profiles_employee_number" ON "public"."profiles" USING "btree" ("employee_number");



CREATE INDEX "idx_profiles_employment_status" ON "public"."profiles" USING "btree" ("employment_status");



CREATE INDEX "idx_profiles_full_name" ON "public"."profiles" USING "btree" ("full_name");



CREATE INDEX "idx_profiles_lead_departments" ON "public"."profiles" USING "gin" ("lead_departments");



CREATE INDEX "idx_profiles_office_location" ON "public"."profiles" USING "btree" ("office_location");



CREATE INDEX "idx_profiles_status_changed_by" ON "public"."profiles" USING "btree" ("status_changed_by");



CREATE INDEX "idx_project_items_created_by" ON "public"."project_items" USING "btree" ("created_by");



CREATE INDEX "idx_project_items_project_id" ON "public"."project_items" USING "btree" ("project_id");



CREATE INDEX "idx_project_members_assigned_by" ON "public"."project_members" USING "btree" ("assigned_by");



CREATE INDEX "idx_project_members_is_active" ON "public"."project_members" USING "btree" ("is_active");



CREATE INDEX "idx_project_members_project_id" ON "public"."project_members" USING "btree" ("project_id");



CREATE INDEX "idx_project_members_user_id" ON "public"."project_members" USING "btree" ("user_id");



CREATE INDEX "idx_project_updates_project_id" ON "public"."project_updates" USING "btree" ("project_id");



CREATE INDEX "idx_project_updates_user_id" ON "public"."project_updates" USING "btree" ("user_id");



CREATE INDEX "idx_projects_created_by" ON "public"."projects" USING "btree" ("created_by");



CREATE INDEX "idx_projects_dates" ON "public"."projects" USING "btree" ("deployment_start_date", "deployment_end_date");



CREATE INDEX "idx_projects_manager" ON "public"."projects" USING "btree" ("project_manager_id");



CREATE INDEX "idx_projects_status" ON "public"."projects" USING "btree" ("status");



CREATE INDEX "idx_remote_tasks_created_at" ON "public"."remote_tasks" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_remote_tasks_created_by" ON "public"."remote_tasks" USING "btree" ("created_by");



CREATE INDEX "idx_remote_tasks_meter_id" ON "public"."remote_tasks" USING "btree" ("meter_id");



CREATE INDEX "idx_remote_tasks_odyssey_id" ON "public"."remote_tasks" USING "btree" ("odyssey_task_id");



CREATE INDEX "idx_remote_tasks_status" ON "public"."remote_tasks" USING "btree" ("status");



CREATE INDEX "idx_remote_tasks_task_id" ON "public"."remote_tasks" USING "btree" ("task_id");



CREATE INDEX "idx_salary_structures_comp_id" ON "public"."salary_structures" USING "btree" ("salary_component_id");



CREATE INDEX "idx_starlink_documents_payment" ON "public"."starlink_documents" USING "btree" ("payment_id");



CREATE INDEX "idx_starlink_documents_type" ON "public"."starlink_documents" USING "btree" ("document_type");



CREATE INDEX "idx_starlink_documents_uploaded_by" ON "public"."starlink_documents" USING "btree" ("uploaded_by");



CREATE INDEX "idx_starlink_payments_created_by" ON "public"."starlink_payments" USING "btree" ("created_by");



CREATE INDEX "idx_starlink_payments_due_date" ON "public"."starlink_payments" USING "btree" ("next_payment_due");



CREATE INDEX "idx_starlink_payments_reminder" ON "public"."starlink_payments" USING "btree" ("reminder_sent", "next_payment_due");



CREATE INDEX "idx_starlink_payments_site" ON "public"."starlink_payments" USING "btree" ("site_id");



CREATE INDEX "idx_starlink_payments_status" ON "public"."starlink_payments" USING "btree" ("payment_status");



CREATE INDEX "idx_starlink_sites_active" ON "public"."starlink_sites" USING "btree" ("is_active");



CREATE INDEX "idx_starlink_sites_created_by" ON "public"."starlink_sites" USING "btree" ("created_by");



CREATE INDEX "idx_starlink_sites_serial" ON "public"."starlink_sites" USING "btree" ("serial_number");



CREATE INDEX "idx_starlink_sites_state" ON "public"."starlink_sites" USING "btree" ("state");



CREATE INDEX "idx_sync_state_last_sync" ON "public"."sync_state" USING "btree" ("last_sync_at" DESC);



CREATE INDEX "idx_sync_state_type" ON "public"."sync_state" USING "btree" ("sync_type");



CREATE INDEX "idx_system_settings_updated_by" ON "public"."system_settings" USING "btree" ("updated_by");



CREATE INDEX "idx_task_assignments_task_id" ON "public"."task_assignments" USING "btree" ("task_id");



CREATE INDEX "idx_task_assignments_user_id" ON "public"."task_assignments" USING "btree" ("user_id");



CREATE INDEX "idx_task_updates_task_id" ON "public"."task_updates" USING "btree" ("task_id");



CREATE INDEX "idx_task_updates_user_id_fk" ON "public"."task_updates" USING "btree" ("user_id");



CREATE INDEX "idx_task_user_completion_task_id" ON "public"."task_user_completion" USING "btree" ("task_id");



CREATE INDEX "idx_task_user_completion_user_id" ON "public"."task_user_completion" USING "btree" ("user_id");



CREATE INDEX "idx_tasks_assigned_by_fk" ON "public"."tasks" USING "btree" ("assigned_by");



CREATE INDEX "idx_tasks_assigned_to" ON "public"."tasks" USING "btree" ("assigned_to");



CREATE INDEX "idx_tasks_assignment_type" ON "public"."tasks" USING "btree" ("assignment_type");



CREATE INDEX "idx_tasks_category" ON "public"."tasks" USING "btree" ("category");



CREATE INDEX "idx_tasks_department" ON "public"."tasks" USING "btree" ("department");



CREATE INDEX "idx_tasks_project_id" ON "public"."tasks" USING "btree" ("project_id");



CREATE INDEX "idx_tasks_status" ON "public"."tasks" USING "btree" ("status");



CREATE INDEX "idx_tasks_week_year" ON "public"."tasks" USING "btree" ("year", "week_number");



CREATE INDEX "idx_timesheets_approved_by" ON "public"."timesheets" USING "btree" ("approved_by");



CREATE INDEX "idx_timesheets_user_week" ON "public"."timesheets" USING "btree" ("user_id", "week_start_date");



CREATE INDEX "idx_token_records_created_at" ON "public"."token_records" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_token_records_currency" ON "public"."token_records" USING "btree" ("currency");



CREATE INDEX "idx_token_records_customer_id" ON "public"."token_records" USING "btree" ("customer_id");



CREATE INDEX "idx_token_records_generated_at" ON "public"."token_records" USING "btree" ("generated_at" DESC);



CREATE INDEX "idx_token_records_generated_by" ON "public"."token_records" USING "btree" ("generated_by");



CREATE INDEX "idx_token_records_meter_id" ON "public"."token_records" USING "btree" ("meter_id");



CREATE INDEX "idx_token_records_odyssey_meter_id" ON "public"."token_records" USING "btree" ("odyssey_meter_id");



CREATE INDEX "idx_token_records_site_id" ON "public"."token_records" USING "btree" ("site_id");



CREATE INDEX "idx_token_records_source" ON "public"."token_records" USING "btree" ("source");



CREATE INDEX "idx_token_records_token_type" ON "public"."token_records" USING "btree" ("token_type");



CREATE INDEX "idx_token_records_transaction_type" ON "public"."token_records" USING "btree" ("transaction_type");



CREATE INDEX "idx_token_sales_created_at" ON "public"."token_sales" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_token_sales_customer_id" ON "public"."token_sales" USING "btree" ("customer_id");



CREATE INDEX "idx_token_sales_generated_by" ON "public"."token_sales" USING "btree" ("generated_by");



CREATE INDEX "idx_token_sales_meter_id" ON "public"."token_sales" USING "btree" ("meter_id");



CREATE UNIQUE INDEX "idx_unique_meter_readings" ON "public"."meter_readings" USING "btree" ("meter_id", "timestamp");



CREATE UNIQUE INDEX "idx_unique_remote_tasks" ON "public"."remote_tasks" USING "btree" ("odyssey_task_id");



CREATE INDEX "idx_user_documentation_user_id" ON "public"."user_documentation" USING "btree" ("user_id");



CREATE INDEX "idx_weekly_reports_user_id" ON "public"."weekly_reports" USING "btree" ("user_id");



CREATE UNIQUE INDEX "unique_current_asset_assignment" ON "public"."asset_assignments" USING "btree" ("asset_id") WHERE (("is_current" = true) AND ("assigned_to" IS NOT NULL));



CREATE OR REPLACE TRIGGER "audit_asset_assignment_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."asset_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."audit_asset_assignment_changes"();



CREATE OR REPLACE TRIGGER "audit_assets_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_attendance_records_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."attendance_records" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_department_payments_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."department_payments" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_departments_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."departments" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_employee_salaries_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."employee_salaries" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_employee_suspensions_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."employee_suspensions" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_feedback_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."feedback" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_goals_objectives_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."goals_objectives" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_job_postings_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."job_postings" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_leave_approvals_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."leave_approvals" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_leave_requests_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."leave_requests" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_payment_categories_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."payment_categories" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_payment_documents_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."payment_documents" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_pending_users_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."pending_users" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_performance_reviews_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."performance_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_profiles_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_projects_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_roles_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_tasks_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "audit_user_documentation_changes" AFTER INSERT OR DELETE OR UPDATE ON "public"."user_documentation" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_changes"();



CREATE OR REPLACE TRIGGER "enforce_acquisition_year_order" BEFORE INSERT ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "public"."check_acquisition_year_order"();



CREATE OR REPLACE TRIGGER "on_new_notification" AFTER INSERT ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_notification"();



CREATE OR REPLACE TRIGGER "on_task_status_change" AFTER UPDATE ON "public"."remote_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."notify_task_completed"();



CREATE OR REPLACE TRIGGER "on_token_generated" AFTER INSERT ON "public"."token_sales" FOR EACH ROW EXECUTE FUNCTION "public"."notify_token_generated"();



CREATE OR REPLACE TRIGGER "populate_payment_categories" AFTER INSERT OR UPDATE OF "category" ON "public"."department_payments" FOR EACH ROW EXECUTE FUNCTION "public"."auto_add_payment_category"();



CREATE OR REPLACE TRIGGER "prevent_asset_number_gaps" BEFORE DELETE ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "public"."check_asset_deletion_allowed"();



CREATE OR REPLACE TRIGGER "set_asset_issues_updated_at" BEFORE UPDATE ON "public"."asset_issues" FOR EACH ROW EXECUTE FUNCTION "public"."update_asset_issues_updated_at"();



CREATE OR REPLACE TRIGGER "set_departments_updated_at" BEFORE UPDATE ON "public"."departments" FOR EACH ROW EXECUTE FUNCTION "public"."handle_departments_updated_at"();



CREATE OR REPLACE TRIGGER "set_dept_payments_updated_at" BEFORE UPDATE ON "public"."department_payments" FOR EACH ROW EXECUTE FUNCTION "public"."handle_dept_payments_updated_at"();



CREATE OR REPLACE TRIGGER "sync_contact_to_customer" AFTER UPDATE ON "public"."crm_contacts" FOR EACH ROW WHEN ((("old"."contact_name" IS DISTINCT FROM "new"."contact_name") OR ("old"."phone" IS DISTINCT FROM "new"."phone") OR ("old"."email" IS DISTINCT FROM "new"."email"))) EXECUTE FUNCTION "public"."sync_customer_from_contact"();



CREATE OR REPLACE TRIGGER "tr_broadcast_event_notification" AFTER INSERT ON "public"."event_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."broadcast_event_notification"();



CREATE OR REPLACE TRIGGER "trigger_starlink_payments_updated_at" BEFORE UPDATE ON "public"."starlink_payments" FOR EACH ROW EXECUTE FUNCTION "public"."update_starlink_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_starlink_sites_updated_at" BEFORE UPDATE ON "public"."starlink_sites" FOR EACH ROW EXECUTE FUNCTION "public"."update_starlink_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_office_locations_updated_at" BEFORE UPDATE ON "public"."office_locations" FOR EACH ROW EXECUTE FUNCTION "public"."update_office_locations_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_task_status_on_completion" AFTER INSERT ON "public"."task_user_completion" FOR EACH ROW EXECUTE FUNCTION "public"."update_task_status_from_completions"();



CREATE OR REPLACE TRIGGER "update_asset_types_updated_at" BEFORE UPDATE ON "public"."asset_types" FOR EACH ROW EXECUTE FUNCTION "public"."update_asset_types_updated_at"();



CREATE OR REPLACE TRIGGER "update_assets_updated_at" BEFORE UPDATE ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_customers_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_employee_suspensions_updated_at" BEFORE UPDATE ON "public"."employee_suspensions" FOR EACH ROW EXECUTE FUNCTION "public"."update_employee_suspensions_updated_at"();



CREATE OR REPLACE TRIGGER "update_gateways_updated_at" BEFORE UPDATE ON "public"."gateways" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_gprs_status_updated_at" BEFORE UPDATE ON "public"."gprs_status" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_meters_updated_at" BEFORE UPDATE ON "public"."meters" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_project_items_updated_at" BEFORE UPDATE ON "public"."project_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_sync_state_updated_at" BEFORE UPDATE ON "public"."sync_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_system_settings_updated_at" BEFORE UPDATE ON "public"."system_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_tariffs_updated_at" BEFORE UPDATE ON "public"."tariffs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_tasks_updated_at" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_documentation_updated_at" BEFORE UPDATE ON "public"."user_documentation" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_weekly_reports_updated_at" BEFORE UPDATE ON "public"."weekly_reports" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."admin_logs"
    ADD CONSTRAINT "admin_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_logs"
    ADD CONSTRAINT "admin_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_job_posting_id_fkey" FOREIGN KEY ("job_posting_id") REFERENCES "public"."job_postings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_assignments"
    ADD CONSTRAINT "asset_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_assignments"
    ADD CONSTRAINT "asset_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."asset_assignments"
    ADD CONSTRAINT "asset_assignments_assigned_from_fkey" FOREIGN KEY ("assigned_from") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."asset_assignments"
    ADD CONSTRAINT "asset_assignments_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."asset_issues"
    ADD CONSTRAINT "asset_issues_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_issues"
    ADD CONSTRAINT "asset_issues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."asset_issues"
    ADD CONSTRAINT "asset_issues_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."asset_types"
    ADD CONSTRAINT "asset_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."consumption_data"
    ADD CONSTRAINT "consumption_data_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id");



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_contacts"
    ADD CONSTRAINT "crm_contacts_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id");



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id");



ALTER TABLE ONLY "public"."department_payments"
    ADD CONSTRAINT "department_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."department_payments"
    ADD CONSTRAINT "department_payments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_payments"
    ADD CONSTRAINT "department_payments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."starlink_sites"("id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_department_head_id_fkey" FOREIGN KEY ("department_head_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."employee_salaries"
    ADD CONSTRAINT "employee_salaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_suspensions"
    ADD CONSTRAINT "employee_suspensions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_suspensions"
    ADD CONSTRAINT "employee_suspensions_lifted_by_fkey" FOREIGN KEY ("lifted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."employee_suspensions"
    ADD CONSTRAINT "employee_suspensions_suspended_by_fkey" FOREIGN KEY ("suspended_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."event_notifications"
    ADD CONSTRAINT "event_notifications_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."event_notifications"
    ADD CONSTRAINT "event_notifications_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."firmware_tasks"
    ADD CONSTRAINT "firmware_tasks_firmware_id_fkey" FOREIGN KEY ("firmware_id") REFERENCES "public"."firmware_updates"("id");



ALTER TABLE ONLY "public"."firmware_tasks"
    ADD CONSTRAINT "firmware_tasks_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id");



ALTER TABLE ONLY "public"."goals_objectives"
    ADD CONSTRAINT "goals_objectives_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."review_cycles"("id");



ALTER TABLE ONLY "public"."goals_objectives"
    ADD CONSTRAINT "goals_objectives_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gprs_status"
    ADD CONSTRAINT "gprs_status_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gprs_tasks"
    ADD CONSTRAINT "gprs_tasks_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id");



ALTER TABLE ONLY "public"."interviews"
    ADD CONSTRAINT "interviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interviews"
    ADD CONSTRAINT "interviews_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."job_postings"
    ADD CONSTRAINT "job_postings_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."leave_approvals"
    ADD CONSTRAINT "leave_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_approvals"
    ADD CONSTRAINT "leave_approvals_approver_id_profiles_fkey" FOREIGN KEY ("approver_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."leave_approvals"
    ADD CONSTRAINT "leave_approvals_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_balances"
    ADD CONSTRAINT "leave_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leave_requests"
    ADD CONSTRAINT "leave_requests_user_id_profiles_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."meter_readings"
    ADD CONSTRAINT "meter_readings_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meters"
    ADD CONSTRAINT "meters_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meters"
    ADD CONSTRAINT "meters_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id");



ALTER TABLE ONLY "public"."meters"
    ADD CONSTRAINT "meters_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "public"."tariffs"("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offers"
    ADD CONSTRAINT "offers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."overtime_requests"
    ADD CONSTRAINT "overtime_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."overtime_requests"
    ADD CONSTRAINT "overtime_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_documents"
    ADD CONSTRAINT "payment_documents_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."department_payments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_documents"
    ADD CONSTRAINT "payment_documents_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "public"."payment_documents"("id");



ALTER TABLE ONLY "public"."payment_documents"
    ADD CONSTRAINT "payment_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payroll_entries"
    ADD CONSTRAINT "payroll_entries_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payroll_entries"
    ADD CONSTRAINT "payroll_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_payroll_entry_id_fkey" FOREIGN KEY ("payroll_entry_id") REFERENCES "public"."payroll_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payslips"
    ADD CONSTRAINT "payslips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."performance_ratings"
    ADD CONSTRAINT "performance_ratings_performance_review_id_fkey" FOREIGN KEY ("performance_review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."review_cycles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."performance_reviews"
    ADD CONSTRAINT "performance_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_status_changed_by_fkey" FOREIGN KEY ("status_changed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."project_items"
    ADD CONSTRAINT "project_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_items"
    ADD CONSTRAINT "project_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_updates"
    ADD CONSTRAINT "project_updates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_project_manager_id_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."remote_tasks"
    ADD CONSTRAINT "remote_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."remote_tasks"
    ADD CONSTRAINT "remote_tasks_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id");



ALTER TABLE ONLY "public"."salary_structures"
    ADD CONSTRAINT "salary_structures_employee_salary_id_fkey" FOREIGN KEY ("employee_salary_id") REFERENCES "public"."employee_salaries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salary_structures"
    ADD CONSTRAINT "salary_structures_salary_component_id_fkey" FOREIGN KEY ("salary_component_id") REFERENCES "public"."salary_components"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."starlink_documents"
    ADD CONSTRAINT "starlink_documents_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."starlink_payments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."starlink_documents"
    ADD CONSTRAINT "starlink_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."starlink_payments"
    ADD CONSTRAINT "starlink_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."starlink_payments"
    ADD CONSTRAINT "starlink_payments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."starlink_sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."starlink_sites"
    ADD CONSTRAINT "starlink_sites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignments"
    ADD CONSTRAINT "task_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_updates"
    ADD CONSTRAINT "task_updates_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_updates"
    ADD CONSTRAINT "task_updates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."task_user_completion"
    ADD CONSTRAINT "task_user_completion_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_user_completion"
    ADD CONSTRAINT "task_user_completion_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."timesheets"
    ADD CONSTRAINT "timesheets_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."timesheets"
    ADD CONSTRAINT "timesheets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_records"
    ADD CONSTRAINT "token_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."token_records"
    ADD CONSTRAINT "token_records_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."token_records"
    ADD CONSTRAINT "token_records_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id");



ALTER TABLE ONLY "public"."token_sales"
    ADD CONSTRAINT "token_sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."token_sales"
    ADD CONSTRAINT "token_sales_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."token_sales"
    ADD CONSTRAINT "token_sales_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id");



ALTER TABLE ONLY "public"."user_documentation"
    ADD CONSTRAINT "user_documentation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_reports"
    ADD CONSTRAINT "weekly_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Admin logs insert policy" ON "public"."admin_logs" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Admins can delete categories" ON "public"."payment_categories" FOR DELETE TO "authenticated" USING ("public"."has_role"('admin'::"text"));



CREATE POLICY "Admins can delete profiles" ON "public"."profiles" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "Admins can insert categories" ON "public"."payment_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_role"('admin'::"text"));



CREATE POLICY "Admins can manage roles" ON "public"."roles" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['super_admin'::"public"."user_role", 'admin'::"public"."user_role"]))))));



CREATE POLICY "Admins can manage system settings" ON "public"."system_settings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['super_admin'::"public"."user_role", 'admin'::"public"."user_role"]))))));



CREATE POLICY "Admins can update categories" ON "public"."payment_categories" FOR UPDATE TO "authenticated" USING ("public"."has_role"('admin'::"text"));



CREATE POLICY "Admins can view admin logs" ON "public"."admin_logs" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Anon can read system settings" ON "public"."system_settings" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Anyone can view active departments" ON "public"."departments" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Applications delete policy" ON "public"."applications" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Applications insert policy" ON "public"."applications" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



CREATE POLICY "Applications select policy" ON "public"."applications" FOR SELECT TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Applications update policy" ON "public"."applications" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Asset assignments delete policy" ON "public"."asset_assignments" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Asset assignments insert policy" ON "public"."asset_assignments" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('lead'::"text") AS "has_role")));



CREATE POLICY "Asset assignments select policy" ON "public"."asset_assignments" FOR SELECT TO "authenticated" USING ((("assigned_to" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "asset_assignments"."assigned_to") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Asset assignments update policy" ON "public"."asset_assignments" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('lead'::"text") AS "has_role")));



CREATE POLICY "Asset issues delete policy" ON "public"."asset_issues" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Asset issues insert policy" ON "public"."asset_issues" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



CREATE POLICY "Asset issues select policy" ON "public"."asset_issues" FOR SELECT TO "authenticated" USING ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "asset_issues"."created_by") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Asset issues update policy" ON "public"."asset_issues" FOR UPDATE TO "authenticated" USING ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Asset types delete policy" ON "public"."asset_types" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Asset types insert policy" ON "public"."asset_types" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Asset types select policy" ON "public"."asset_types" FOR SELECT TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Asset types update policy" ON "public"."asset_types" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Assets delete policy" ON "public"."assets" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Assets insert policy" ON "public"."assets" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Assets select policy" ON "public"."assets" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND ("department" = ( SELECT "profiles"."department"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = ( SELECT "auth"."uid"() AS "uid"))
 LIMIT 1)))));



CREATE POLICY "Assets update policy" ON "public"."assets" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Attendance delete policy" ON "public"."attendance_records" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Attendance select policy" ON "public"."attendance_records" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "attendance_records"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Audit logs insert policy" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



CREATE POLICY "Audit logs select policy" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Authenticated users can read system settings" ON "public"."system_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view roles" ON "public"."roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "CRM tags select policy" ON "public"."crm_tags" FOR SELECT TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Categories view policy" ON "public"."payment_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Consumption data delete" ON "public"."consumption_data" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Consumption data insert" ON "public"."consumption_data" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Consumption data update" ON "public"."consumption_data" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Customers delete policy" ON "public"."customers" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Customers insert policy" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Customers select policy" ON "public"."customers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Customers update policy" ON "public"."customers" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Department payments delete policy" ON "public"."department_payments" FOR DELETE TO "authenticated" USING ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Department payments insert policy" ON "public"."department_payments" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('admin'::"text") OR "public"."has_role"('lead'::"text")));



CREATE POLICY "Department payments select policy" ON "public"."department_payments" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p1"
  WHERE (("p1"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("p1"."department_id" = "department_payments"."department_id")))))));



CREATE POLICY "Department payments update policy" ON "public"."department_payments" FOR UPDATE TO "authenticated" USING (("public"."has_role"('admin'::"text") OR ("public"."has_role"('lead'::"text") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK (("public"."has_role"('admin'::"text") OR ("public"."has_role"('lead'::"text") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Departments delete policy" ON "public"."departments" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Departments insert policy" ON "public"."departments" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Departments update policy" ON "public"."departments" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Employee salaries delete policy" ON "public"."employee_salaries" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Employee salaries insert policy" ON "public"."employee_salaries" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Employee salaries select policy" ON "public"."employee_salaries" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Employee salaries update policy" ON "public"."employee_salaries" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Employee suspensions insert policy" ON "public"."employee_suspensions" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Employee suspensions select policy" ON "public"."employee_suspensions" FOR SELECT TO "authenticated" USING ((("employee_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Employee suspensions update policy" ON "public"."employee_suspensions" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Events delete policy" ON "public"."event_notifications" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Events insert policy" ON "public"."event_notifications" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Events select policy" ON "public"."event_notifications" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Events employee acknowledge" ON "public"."event_notifications" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") AND ("acknowledged" = false))) WITH CHECK ((("acknowledged" = true) AND ("acknowledged_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Events update policy" ON "public"."event_notifications" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('employee'::"text") AS "has_role"))) WITH CHECK ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (("acknowledged" = true) AND ("acknowledged_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Everyone can view submitted reports" ON "public"."weekly_reports" FOR SELECT USING ((("status" = 'submitted'::"text") OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "Feedback delete policy" ON "public"."feedback" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Feedback insert policy" ON "public"."feedback" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Feedback update policy" ON "public"."feedback" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Feedback view policy" ON "public"."feedback" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Firmware tasks delete policy" ON "public"."firmware_tasks" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Firmware tasks insert policy" ON "public"."firmware_tasks" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Firmware tasks select policy" ON "public"."firmware_tasks" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Firmware tasks update policy" ON "public"."firmware_tasks" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Firmware updates delete policy" ON "public"."firmware_updates" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Firmware updates insert policy" ON "public"."firmware_updates" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Firmware updates select policy" ON "public"."firmware_updates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Firmware updates update policy" ON "public"."firmware_updates" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "GPRS status delete policy" ON "public"."gprs_status" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "GPRS status insert policy" ON "public"."gprs_status" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "GPRS status select policy" ON "public"."gprs_status" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "GPRS status update policy" ON "public"."gprs_status" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "GPRS tasks select policy" ON "public"."gprs_tasks" FOR SELECT TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Gateways delete policy" ON "public"."gateways" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Gateways insert policy" ON "public"."gateways" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Gateways select policy" ON "public"."gateways" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Gateways update policy" ON "public"."gateways" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Goals delete policy" ON "public"."goals_objectives" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Goals insert policy" ON "public"."goals_objectives" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "goals_objectives"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Goals select policy" ON "public"."goals_objectives" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "goals_objectives"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Goals update policy" ON "public"."goals_objectives" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Interviews delete policy" ON "public"."interviews" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Interviews insert policy" ON "public"."interviews" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Interviews select policy" ON "public"."interviews" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ("interviewer_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Interviews update policy" ON "public"."interviews" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ("interviewer_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Job postings delete policy" ON "public"."job_postings" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Job postings insert policy" ON "public"."job_postings" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Job postings select policy" ON "public"."job_postings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Job postings update policy" ON "public"."job_postings" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leads can manage their own reports" ON "public"."weekly_reports" TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role"])))))));



CREATE POLICY "Leave approvals delete policy" ON "public"."leave_approvals" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leave approvals insert policy" ON "public"."leave_approvals" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leave approvals select policy" ON "public"."leave_approvals" FOR SELECT TO "authenticated" USING ((("approver_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "leave_approvals"."approver_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid")))))))) OR (EXISTS ( SELECT 1
   FROM "public"."leave_requests"
  WHERE (("leave_requests"."id" = "leave_approvals"."leave_request_id") AND ("leave_requests"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Leave approvals update policy" ON "public"."leave_approvals" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leave balances delete policy" ON "public"."leave_balances" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leave balances insert policy" ON "public"."leave_balances" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leave balances select policy" ON "public"."leave_balances" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "leave_balances"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Leave balances update policy" ON "public"."leave_balances" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leave requests delete policy" ON "public"."leave_requests" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leave requests insert policy" ON "public"."leave_requests" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Leave requests select policy" ON "public"."leave_requests" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "leave_requests"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Leave requests update policy" ON "public"."leave_requests" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "leave_requests"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid")))))))) OR (("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("status")::"text" = 'pending'::"text"))));



CREATE POLICY "Leave types delete policy" ON "public"."leave_types" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leave types insert policy" ON "public"."leave_types" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Leave types select policy" ON "public"."leave_types" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Leave types update policy" ON "public"."leave_types" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Meter readings delete policy" ON "public"."meter_readings" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Meter readings insert policy" ON "public"."meter_readings" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Meter readings select policy" ON "public"."meter_readings" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Meter readings update policy" ON "public"."meter_readings" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Meters delete policy" ON "public"."meters" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Meters insert policy" ON "public"."meters" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Meters select policy" ON "public"."meters" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Meters update policy" ON "public"."meters" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Notification preferences insert" ON "public"."notification_preferences" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Notification preferences select policy" ON "public"."notification_preferences" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Notification preferences update" ON "public"."notification_preferences" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Notifications insert policy" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text") OR (( SELECT "auth"."uid"() AS "uid") IS NOT NULL)));



CREATE POLICY "Offers delete policy" ON "public"."offers" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Offers insert policy" ON "public"."offers" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Offers select policy" ON "public"."offers" FOR SELECT TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Offers update policy" ON "public"."offers" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Office locations delete policy" ON "public"."office_locations" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('super_admin'::"text") AS "has_role"));



CREATE POLICY "Office locations insert policy" ON "public"."office_locations" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Office locations select policy" ON "public"."office_locations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Office locations update policy" ON "public"."office_locations" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Overtime requests delete policy" ON "public"."overtime_requests" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Overtime requests insert policy" ON "public"."overtime_requests" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Overtime requests select policy" ON "public"."overtime_requests" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "overtime_requests"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Overtime requests update policy" ON "public"."overtime_requests" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Payment documents delete policy" ON "public"."payment_documents" FOR DELETE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Payment documents insert policy" ON "public"."payment_documents" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('admin'::"text") OR "public"."has_role"('lead'::"text")));



CREATE POLICY "Payment documents select policy" ON "public"."payment_documents" FOR SELECT TO "authenticated" USING (("public"."has_role"('admin'::"text") OR ("public"."has_role"('lead'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."department_payments" "dp"
  WHERE ("dp"."id" = "payment_documents"."payment_id")))) OR ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Payment documents update policy" ON "public"."payment_documents" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Payroll entries delete policy" ON "public"."payroll_entries" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Payroll entries insert policy" ON "public"."payroll_entries" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Payroll entries select policy" ON "public"."payroll_entries" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Payroll entries update policy" ON "public"."payroll_entries" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Payroll periods delete policy" ON "public"."payroll_periods" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Payroll periods insert policy" ON "public"."payroll_periods" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Payroll periods select policy" ON "public"."payroll_periods" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Payroll periods update policy" ON "public"."payroll_periods" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Payslips delete policy" ON "public"."payslips" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Payslips insert policy" ON "public"."payslips" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Payslips select policy" ON "public"."payslips" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Payslips update policy" ON "public"."payslips" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Pending users delete policy" ON "public"."pending_users" FOR DELETE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('super_admin'::"text") AS "has_role")));



CREATE POLICY "Pending users insert policy" ON "public"."pending_users" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('super_admin'::"text") AS "has_role")));



CREATE POLICY "Pending users select policy" ON "public"."pending_users" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('super_admin'::"text") AS "has_role")));



CREATE POLICY "Pending users update policy" ON "public"."pending_users" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('super_admin'::"text") AS "has_role")));



CREATE POLICY "Performance ratings delete policy" ON "public"."performance_ratings" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Performance ratings insert policy" ON "public"."performance_ratings" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Performance ratings select policy" ON "public"."performance_ratings" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (EXISTS ( SELECT 1
   FROM "public"."performance_reviews" "pr"
  WHERE (("pr"."id" = "performance_ratings"."performance_review_id") AND (("pr"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("pr"."reviewer_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



CREATE POLICY "Performance ratings update policy" ON "public"."performance_ratings" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Performance reviews delete" ON "public"."performance_reviews" FOR DELETE TO "authenticated" USING ("public"."has_role"('admin'::"text"));



CREATE POLICY "Performance reviews insert" ON "public"."performance_reviews" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('lead'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Performance reviews select" ON "public"."performance_reviews" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("reviewer_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_role"('admin'::"text") OR ("public"."has_role"('lead'::"text") AND ("user_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid")))))))));



CREATE POLICY "Performance reviews update" ON "public"."performance_reviews" FOR UPDATE TO "authenticated" USING ((("reviewer_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Profiles insert policy" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("user_roles"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::"text"[]))))));



CREATE POLICY "Profiles select policy" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Profiles update policy" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("user_roles"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::"text"[])))))));



CREATE POLICY "Project items delete policy" ON "public"."project_items" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Project items insert policy" ON "public"."project_items" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_items"."project_id") AND ("project_members"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Project items select policy" ON "public"."project_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Project items update policy" ON "public"."project_items" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_items"."project_id") AND ("project_members"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Project members delete policy" ON "public"."project_members" FOR DELETE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('lead'::"text") AS "has_role")));



CREATE POLICY "Project members insert policy" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "project_members"."project_id") AND (("projects"."created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("projects"."project_manager_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('lead'::"text") AS "has_role")));



CREATE POLICY "Project members select policy" ON "public"."project_members" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Project members update policy" ON "public"."project_members" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "project_members"."project_id") AND (("projects"."created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("projects"."project_manager_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('lead'::"text") AS "has_role")));



CREATE POLICY "Project updates delete policy" ON "public"."project_updates" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Project updates insert policy" ON "public"."project_updates" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_updates"."project_id") AND ("project_members"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Project updates select policy" ON "public"."project_updates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Project updates update policy" ON "public"."project_updates" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_updates"."project_id") AND ("project_members"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Projects management policy" ON "public"."projects" TO "authenticated" USING (("public"."has_role"('admin'::"text") OR ("project_manager_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "projects"."id") AND ("project_members"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Remote tasks delete policy" ON "public"."remote_tasks" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Remote tasks insert policy" ON "public"."remote_tasks" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Remote tasks select policy" ON "public"."remote_tasks" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Remote tasks update policy" ON "public"."remote_tasks" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Review cycles admin delete" ON "public"."review_cycles" FOR DELETE TO "authenticated" USING ("public"."has_role"('admin'::"text"));



CREATE POLICY "Review cycles admin insert" ON "public"."review_cycles" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_role"('admin'::"text"));



CREATE POLICY "Review cycles admin update" ON "public"."review_cycles" FOR UPDATE TO "authenticated" USING ("public"."has_role"('admin'::"text"));



CREATE POLICY "Review cycles select policy" ON "public"."review_cycles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Salary components admin delete" ON "public"."salary_components" FOR DELETE TO "authenticated" USING ("public"."has_role"('admin'::"text"));



CREATE POLICY "Salary components admin insert" ON "public"."salary_components" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_role"('admin'::"text"));



CREATE POLICY "Salary components admin update" ON "public"."salary_components" FOR UPDATE TO "authenticated" USING ("public"."has_role"('admin'::"text"));



CREATE POLICY "Salary components select policy" ON "public"."salary_components" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Salary structures delete policy" ON "public"."salary_structures" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Salary structures insert policy" ON "public"."salary_structures" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Salary structures select policy" ON "public"."salary_structures" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (EXISTS ( SELECT 1
   FROM "public"."employee_salaries" "es"
  WHERE (("es"."id" = "salary_structures"."employee_salary_id") AND ("es"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Salary structures update policy" ON "public"."salary_structures" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Shifts admin delete" ON "public"."shifts" FOR DELETE TO "authenticated" USING ("public"."has_role"('admin'::"text"));



CREATE POLICY "Shifts admin insert" ON "public"."shifts" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_role"('admin'::"text"));



CREATE POLICY "Shifts admin update" ON "public"."shifts" FOR UPDATE TO "authenticated" USING ("public"."has_role"('admin'::"text"));



CREATE POLICY "Shifts select policy" ON "public"."shifts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "employee can create contacts" ON "public"."crm_contacts" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can create crm activities" ON "public"."crm_activities" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can create notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_role"('employee'::"text") AS "has_role") OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "employee can create opportunities" ON "public"."crm_opportunities" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can create pipelines" ON "public"."crm_pipelines" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can create tags" ON "public"."crm_tags" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can delete activities" ON "public"."crm_activities" FOR DELETE TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can delete contacts" ON "public"."crm_contacts" FOR DELETE TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can delete opportunities" ON "public"."crm_opportunities" FOR DELETE TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can update activities" ON "public"."crm_activities" FOR UPDATE TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can update contacts" ON "public"."crm_contacts" FOR UPDATE TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can update opportunities" ON "public"."crm_opportunities" FOR UPDATE TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can view all activities" ON "public"."crm_activities" FOR SELECT TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can view consumption data" ON "public"."consumption_data" FOR SELECT TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('visitor'::"text")));



CREATE POLICY "employee can view contacts" ON "public"."crm_contacts" FOR SELECT TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee can view opportunities" ON "public"."crm_opportunities" FOR SELECT TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "employee create token sales" ON "public"."token_sales" FOR INSERT WITH CHECK ("public"."has_role"('employee'::"text"));



CREATE POLICY "Starlink documents management" ON "public"."starlink_documents" TO "authenticated" USING (("public"."has_role"('admin'::"text") OR "public"."has_role"('employee'::"text")));



CREATE POLICY "Starlink payments delete policy" ON "public"."starlink_payments" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Starlink payments insert policy" ON "public"."starlink_payments" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Starlink payments select policy" ON "public"."starlink_payments" FOR SELECT TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('super_admin'::"text") AS "has_role")));



CREATE POLICY "Starlink payments update policy" ON "public"."starlink_payments" FOR UPDATE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Starlink sites management" ON "public"."starlink_sites" TO "authenticated" USING (("public"."has_role"('admin'::"text") OR "public"."has_role"('employee'::"text")));



CREATE POLICY "Sync state select policy" ON "public"."sync_state" FOR SELECT TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('admin'::"text")));



CREATE POLICY "Tariffs admin manage" ON "public"."tariffs" TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('super_admin'::"text") AS "has_role"))) WITH CHECK ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('super_admin'::"text") AS "has_role")));



CREATE POLICY "Tariffs view policy" ON "public"."tariffs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Task assignments delete policy" ON "public"."task_assignments" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Task assignments insert policy" ON "public"."task_assignments" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "task_assignments"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Task assignments select policy" ON "public"."task_assignments" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "task_assignments"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Task assignments update policy" ON "public"."task_assignments" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "task_assignments"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Task updates insert policy" ON "public"."task_updates" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Task updates select policy" ON "public"."task_updates" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "task_updates"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Task user completion insert policy" ON "public"."task_user_completion" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."task_assignments"
  WHERE (("task_assignments"."task_id" = "task_user_completion"."task_id") AND ("task_assignments"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Task user completion select policy" ON "public"."task_user_completion" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role")));



CREATE POLICY "Tasks delete policy" ON "public"."tasks" FOR DELETE TO "authenticated" USING (( SELECT "public"."has_role"('admin'::"text") AS "has_role"));



CREATE POLICY "Tasks insert policy" ON "public"."tasks" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('lead'::"text") AS "has_role")));



CREATE POLICY "Tasks select policy" ON "public"."tasks" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Tasks update policy" ON "public"."tasks" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('lead'::"text") AS "has_role")));



CREATE POLICY "Timesheets delete policy" ON "public"."timesheets" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Timesheets insert policy" ON "public"."timesheets" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Timesheets select policy" ON "public"."timesheets" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR (( SELECT "public"."has_role"('lead'::"text") AS "has_role") AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "timesheets"."user_id") AND ("profiles"."department_id" = ( SELECT "profiles_1"."department_id"
           FROM "public"."profiles" "profiles_1"
          WHERE ("profiles_1"."id" = ( SELECT "auth"."uid"() AS "uid"))))))))));



CREATE POLICY "Timesheets update policy" ON "public"."timesheets" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Token records management" ON "public"."token_records" TO "authenticated" USING (("public"."has_role"('admin'::"text") OR "public"."has_role"('employee'::"text"))) WITH CHECK (("public"."has_role"('admin'::"text") OR "public"."has_role"('employee'::"text")));



CREATE POLICY "User documentation delete policy" ON "public"."user_documentation" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "User documentation insert policy" ON "public"."user_documentation" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "User documentation select policy" ON "public"."user_documentation" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "User documentation update policy" ON "public"."user_documentation" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "User roles delete policy" ON "public"."user_roles" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("ur"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::"text"[]))))));



CREATE POLICY "User roles insert policy" ON "public"."user_roles" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("ur"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::"text"[]))))));



CREATE POLICY "User roles select (self or admin)" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."has_role"('admin'::"text") AS "has_role") OR ( SELECT "public"."has_role"('super_admin'::"text") AS "has_role")));



CREATE POLICY "User roles update policy" ON "public"."user_roles" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (("ur"."role")::"text" = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying])::"text"[]))))));



CREATE POLICY "Users can clock in" ON "public"."attendance_records" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can clock out" ON "public"."attendance_records" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND ("clock_out" IS NULL))) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view active pipelines" ON "public"."crm_pipelines" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Users can view own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users with access can read token sales" ON "public"."token_sales" FOR SELECT TO "authenticated" USING (("public"."has_role"('employee'::"text") OR "public"."has_role"('visitor'::"text") OR "public"."has_role"('admin'::"text") OR "public"."has_role"('super_admin'::"text")));



ALTER TABLE "public"."admin_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_issues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."consumption_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_opportunities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_pipelines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_salaries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_suspensions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."firmware_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."firmware_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gateways" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."goals_objectives" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gprs_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gprs_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."interviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_postings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_approvals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_balances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leave_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meter_readings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."offers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."office_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."overtime_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payroll_periods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payslips" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."performance_ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."performance_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."remote_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_cycles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salary_components" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salary_structures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shifts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."starlink_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."starlink_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."starlink_sites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tariffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_user_completion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timesheets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_sales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_documentation" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_reports" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."token_records";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































GRANT ALL ON FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assignment_type" "text", "p_assigned_by" "uuid", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assignment_type" "text", "p_assigned_by" "uuid", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_asset"("p_asset_id" "uuid", "p_assigned_to" "uuid", "p_assignment_type" "text", "p_assigned_by" "uuid", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_department_lead"("p_department_id" "uuid", "p_new_lead_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_department_lead"("p_department_id" "uuid", "p_new_lead_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_department_lead"("p_department_id" "uuid", "p_new_lead_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_device"("p_device_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."assign_device"("p_device_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_device"("p_device_id" "uuid", "p_assigned_to" "uuid", "p_assigned_by" "uuid", "p_assignment_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_asset_assignment_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_asset_assignment_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_asset_assignment_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_log_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_log_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_log_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_add_payment_category"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_add_payment_category"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_add_payment_category"() TO "service_role";



GRANT ALL ON FUNCTION "public"."broadcast_event_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."broadcast_event_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."broadcast_event_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_acquisition_year_order"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_acquisition_year_order"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_acquisition_year_order"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_lift_expired_suspensions"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_lift_expired_suspensions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_lift_expired_suspensions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_asset_deletion_allowed"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_asset_deletion_allowed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_asset_deletion_allowed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_notifications"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_notifications"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_notifications"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_data" "jsonb", "p_action_url" "text", "p_priority" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_data" "jsonb", "p_action_url" "text", "p_priority" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_title" "text", "p_message" "text", "p_data" "jsonb", "p_action_url" "text", "p_priority" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text", "p_action_url" "text", "p_action_label" "text", "p_related_entity_type" "text", "p_related_entity_id" "uuid", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text", "p_action_url" "text", "p_action_label" "text", "p_related_entity_type" "text", "p_related_entity_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text", "p_action_url" "text", "p_action_label" "text", "p_related_entity_type" "text", "p_related_entity_id" "uuid", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text", "p_link_url" "text", "p_actor_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_rich_content" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text", "p_link_url" "text", "p_actor_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_rich_content" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_notification"("p_user_id" "uuid", "p_type" "text", "p_category" "text", "p_title" "text", "p_message" "text", "p_priority" "text", "p_link_url" "text", "p_actor_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_rich_content" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_starlink_payment_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_starlink_payment_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_starlink_payment_reminders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_serial_number"("asset_number" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."extract_serial_number"("asset_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_serial_number"("asset_number" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_last_sync_timestamp"("p_sync_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_last_sync_timestamp"("p_sync_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_last_sync_timestamp"("p_sync_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_asset_serial"("asset_code" "text", "year" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_asset_serial"("asset_code" "text", "year" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_asset_serial"("asset_code" "text", "year" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_starlink_dashboard_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_starlink_dashboard_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_starlink_dashboard_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_system_setting"("key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_system_setting"("key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_system_setting"("key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_upcoming_starlink_payments"("days_ahead" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_upcoming_starlink_payments"("days_ahead" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_upcoming_starlink_payments"("days_ahead" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_departments_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_departments_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_departments_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_dept_payments_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_dept_payments_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_dept_payments_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("required_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("required_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("required_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit"("p_action" "text", "p_entity_type" "text", "p_entity_id" "text", "p_user_id" "uuid", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_metadata" "jsonb", "p_site_id" "text", "p_department" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit"("p_action" "text", "p_entity_type" "text", "p_entity_id" "text", "p_user_id" "uuid", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_metadata" "jsonb", "p_site_id" "text", "p_department" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit"("p_action" "text", "p_entity_type" "text", "p_entity_id" "text", "p_user_id" "uuid", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_metadata" "jsonb", "p_site_id" "text", "p_department" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_crm_contact_audit"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_crm_contact_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_crm_contact_audit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_crm_opportunity_audit"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_crm_opportunity_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_crm_opportunity_audit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_notification_read"("notification_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_notification_read"("notification_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_notification_read"("notification_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_notifications_read"("p_user_id" "uuid", "p_notification_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."mark_notifications_read"("p_user_id" "uuid", "p_notification_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_notifications_read"("p_user_id" "uuid", "p_notification_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_task_completed"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_task_completed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_task_completed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_token_generated"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_token_generated"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_token_generated"() TO "service_role";



GRANT ALL ON FUNCTION "public"."populate_notification_actor"() TO "anon";
GRANT ALL ON FUNCTION "public"."populate_notification_actor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."populate_notification_actor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_sync_completion"("p_sync_type" "text", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_records_count" integer, "p_status" "text", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_sync_completion"("p_sync_type" "text", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_records_count" integer, "p_status" "text", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_sync_completion"("p_sync_type" "text", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_records_count" integer, "p_status" "text", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_contact_from_customer"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_contact_from_customer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_contact_from_customer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_customer_from_contact"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_customer_from_contact"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_customer_from_contact"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_asset_issues_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_asset_issues_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_asset_issues_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_asset_types_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_asset_types_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_asset_types_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_crm_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_crm_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_crm_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_employee_suspensions_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_employee_suspensions_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_employee_suspensions_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_office_locations_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_office_locations_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_office_locations_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_overdue_starlink_payments"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_overdue_starlink_payments"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_overdue_starlink_payments"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_starlink_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_starlink_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_starlink_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_system_setting"("key" "text", "value" "jsonb", "user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_system_setting"("key" "text", "value" "jsonb", "user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_system_setting"("key" "text", "value" "jsonb", "user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_task_status_from_completions"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_task_status_from_completions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_task_status_from_completions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";
























GRANT ALL ON TABLE "public"."admin_logs" TO "anon";
GRANT ALL ON TABLE "public"."admin_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_logs" TO "service_role";



GRANT ALL ON TABLE "public"."applications" TO "anon";
GRANT ALL ON TABLE "public"."applications" TO "authenticated";
GRANT ALL ON TABLE "public"."applications" TO "service_role";



GRANT ALL ON TABLE "public"."asset_assignments" TO "anon";
GRANT ALL ON TABLE "public"."asset_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."asset_issues" TO "anon";
GRANT ALL ON TABLE "public"."asset_issues" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_issues" TO "service_role";



GRANT ALL ON TABLE "public"."asset_types" TO "anon";
GRANT ALL ON TABLE "public"."asset_types" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_types" TO "service_role";



GRANT ALL ON TABLE "public"."assets" TO "anon";
GRANT ALL ON TABLE "public"."assets" TO "authenticated";
GRANT ALL ON TABLE "public"."assets" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_records" TO "anon";
GRANT ALL ON TABLE "public"."attendance_records" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_records" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."consumption_data" TO "anon";
GRANT ALL ON TABLE "public"."consumption_data" TO "authenticated";
GRANT ALL ON TABLE "public"."consumption_data" TO "service_role";



GRANT ALL ON TABLE "public"."crm_activities" TO "anon";
GRANT ALL ON TABLE "public"."crm_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_activities" TO "service_role";



GRANT ALL ON TABLE "public"."crm_contacts" TO "anon";
GRANT ALL ON TABLE "public"."crm_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."crm_opportunities" TO "anon";
GRANT ALL ON TABLE "public"."crm_opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_opportunities" TO "service_role";



GRANT ALL ON TABLE "public"."crm_pipelines" TO "anon";
GRANT ALL ON TABLE "public"."crm_pipelines" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_pipelines" TO "service_role";



GRANT ALL ON TABLE "public"."crm_tags" TO "anon";
GRANT ALL ON TABLE "public"."crm_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_tags" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."department_payments" TO "anon";
GRANT ALL ON TABLE "public"."department_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."department_payments" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."employee_salaries" TO "anon";
GRANT ALL ON TABLE "public"."employee_salaries" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_salaries" TO "service_role";



GRANT ALL ON TABLE "public"."employee_suspensions" TO "anon";
GRANT ALL ON TABLE "public"."employee_suspensions" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_suspensions" TO "service_role";



GRANT ALL ON TABLE "public"."event_notifications" TO "anon";
GRANT ALL ON TABLE "public"."event_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."event_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."firmware_tasks" TO "anon";
GRANT ALL ON TABLE "public"."firmware_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."firmware_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."firmware_updates" TO "anon";
GRANT ALL ON TABLE "public"."firmware_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."firmware_updates" TO "service_role";



GRANT ALL ON TABLE "public"."gateways" TO "anon";
GRANT ALL ON TABLE "public"."gateways" TO "authenticated";
GRANT ALL ON TABLE "public"."gateways" TO "service_role";



GRANT ALL ON TABLE "public"."goals_objectives" TO "anon";
GRANT ALL ON TABLE "public"."goals_objectives" TO "authenticated";
GRANT ALL ON TABLE "public"."goals_objectives" TO "service_role";



GRANT ALL ON TABLE "public"."gprs_status" TO "anon";
GRANT ALL ON TABLE "public"."gprs_status" TO "authenticated";
GRANT ALL ON TABLE "public"."gprs_status" TO "service_role";



GRANT ALL ON TABLE "public"."gprs_tasks" TO "anon";
GRANT ALL ON TABLE "public"."gprs_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."gprs_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."interviews" TO "anon";
GRANT ALL ON TABLE "public"."interviews" TO "authenticated";
GRANT ALL ON TABLE "public"."interviews" TO "service_role";



GRANT ALL ON TABLE "public"."job_postings" TO "anon";
GRANT ALL ON TABLE "public"."job_postings" TO "authenticated";
GRANT ALL ON TABLE "public"."job_postings" TO "service_role";



GRANT ALL ON TABLE "public"."leave_approvals" TO "anon";
GRANT ALL ON TABLE "public"."leave_approvals" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_approvals" TO "service_role";



GRANT ALL ON TABLE "public"."leave_balances" TO "anon";
GRANT ALL ON TABLE "public"."leave_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_balances" TO "service_role";



GRANT ALL ON TABLE "public"."leave_requests" TO "anon";
GRANT ALL ON TABLE "public"."leave_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_requests" TO "service_role";



GRANT ALL ON TABLE "public"."leave_types" TO "anon";
GRANT ALL ON TABLE "public"."leave_types" TO "authenticated";
GRANT ALL ON TABLE "public"."leave_types" TO "service_role";



GRANT ALL ON TABLE "public"."meter_readings" TO "anon";
GRANT ALL ON TABLE "public"."meter_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."meter_readings" TO "service_role";



GRANT ALL ON TABLE "public"."meters" TO "anon";
GRANT ALL ON TABLE "public"."meters" TO "authenticated";
GRANT ALL ON TABLE "public"."meters" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."offers" TO "anon";
GRANT ALL ON TABLE "public"."offers" TO "authenticated";
GRANT ALL ON TABLE "public"."offers" TO "service_role";



GRANT ALL ON TABLE "public"."office_locations" TO "anon";
GRANT ALL ON TABLE "public"."office_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."office_locations" TO "service_role";



GRANT ALL ON TABLE "public"."office_location_usage" TO "anon";
GRANT ALL ON TABLE "public"."office_location_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."office_location_usage" TO "service_role";



GRANT ALL ON TABLE "public"."office_locations_by_type" TO "anon";
GRANT ALL ON TABLE "public"."office_locations_by_type" TO "authenticated";
GRANT ALL ON TABLE "public"."office_locations_by_type" TO "service_role";



GRANT ALL ON TABLE "public"."overtime_requests" TO "anon";
GRANT ALL ON TABLE "public"."overtime_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."overtime_requests" TO "service_role";



GRANT ALL ON TABLE "public"."payment_categories" TO "anon";
GRANT ALL ON TABLE "public"."payment_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_categories" TO "service_role";



GRANT ALL ON TABLE "public"."payment_documents" TO "anon";
GRANT ALL ON TABLE "public"."payment_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_documents" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_entries" TO "anon";
GRANT ALL ON TABLE "public"."payroll_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_entries" TO "service_role";



GRANT ALL ON TABLE "public"."payroll_periods" TO "anon";
GRANT ALL ON TABLE "public"."payroll_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."payroll_periods" TO "service_role";



GRANT ALL ON TABLE "public"."payslips" TO "anon";
GRANT ALL ON TABLE "public"."payslips" TO "authenticated";
GRANT ALL ON TABLE "public"."payslips" TO "service_role";



GRANT ALL ON TABLE "public"."pending_users" TO "anon";
GRANT ALL ON TABLE "public"."pending_users" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_users" TO "service_role";



GRANT ALL ON TABLE "public"."performance_ratings" TO "anon";
GRANT ALL ON TABLE "public"."performance_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."performance_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."performance_reviews" TO "anon";
GRANT ALL ON TABLE "public"."performance_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."performance_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_items" TO "anon";
GRANT ALL ON TABLE "public"."project_items" TO "authenticated";
GRANT ALL ON TABLE "public"."project_items" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."project_updates" TO "anon";
GRANT ALL ON TABLE "public"."project_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_updates" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."remote_tasks" TO "anon";
GRANT ALL ON TABLE "public"."remote_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."remote_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."review_cycles" TO "anon";
GRANT ALL ON TABLE "public"."review_cycles" TO "authenticated";
GRANT ALL ON TABLE "public"."review_cycles" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."salary_components" TO "anon";
GRANT ALL ON TABLE "public"."salary_components" TO "authenticated";
GRANT ALL ON TABLE "public"."salary_components" TO "service_role";



GRANT ALL ON TABLE "public"."salary_structures" TO "anon";
GRANT ALL ON TABLE "public"."salary_structures" TO "authenticated";
GRANT ALL ON TABLE "public"."salary_structures" TO "service_role";



GRANT ALL ON TABLE "public"."shifts" TO "anon";
GRANT ALL ON TABLE "public"."shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."shifts" TO "service_role";



GRANT ALL ON TABLE "public"."starlink_documents" TO "anon";
GRANT ALL ON TABLE "public"."starlink_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."starlink_documents" TO "service_role";



GRANT ALL ON TABLE "public"."starlink_payments" TO "anon";
GRANT ALL ON TABLE "public"."starlink_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."starlink_payments" TO "service_role";



GRANT ALL ON TABLE "public"."starlink_sites" TO "anon";
GRANT ALL ON TABLE "public"."starlink_sites" TO "authenticated";
GRANT ALL ON TABLE "public"."starlink_sites" TO "service_role";



GRANT ALL ON TABLE "public"."sync_state" TO "anon";
GRANT ALL ON TABLE "public"."sync_state" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_state" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."tariffs" TO "anon";
GRANT ALL ON TABLE "public"."tariffs" TO "authenticated";
GRANT ALL ON TABLE "public"."tariffs" TO "service_role";



GRANT ALL ON TABLE "public"."task_assignments" TO "anon";
GRANT ALL ON TABLE "public"."task_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."task_updates" TO "anon";
GRANT ALL ON TABLE "public"."task_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."task_updates" TO "service_role";



GRANT ALL ON TABLE "public"."task_user_completion" TO "anon";
GRANT ALL ON TABLE "public"."task_user_completion" TO "authenticated";
GRANT ALL ON TABLE "public"."task_user_completion" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."timesheets" TO "anon";
GRANT ALL ON TABLE "public"."timesheets" TO "authenticated";
GRANT ALL ON TABLE "public"."timesheets" TO "service_role";



GRANT ALL ON TABLE "public"."token_records" TO "anon";
GRANT ALL ON TABLE "public"."token_records" TO "authenticated";
GRANT ALL ON TABLE "public"."token_records" TO "service_role";



GRANT ALL ON TABLE "public"."token_sales" TO "anon";
GRANT ALL ON TABLE "public"."token_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."token_sales" TO "service_role";



GRANT ALL ON TABLE "public"."user_documentation" TO "anon";
GRANT ALL ON TABLE "public"."user_documentation" TO "authenticated";
GRANT ALL ON TABLE "public"."user_documentation" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."v_active_tasks_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_active_tasks_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_active_tasks_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_token_stats" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_token_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_token_stats" TO "service_role";



GRANT ALL ON TABLE "public"."v_latest_meter_readings" TO "anon";
GRANT ALL ON TABLE "public"."v_latest_meter_readings" TO "authenticated";
GRANT ALL ON TABLE "public"."v_latest_meter_readings" TO "service_role";



GRANT ALL ON TABLE "public"."view_dashboard_stats" TO "anon";
GRANT ALL ON TABLE "public"."view_dashboard_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."view_dashboard_stats" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_reports" TO "anon";
GRANT ALL ON TABLE "public"."weekly_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_reports" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































