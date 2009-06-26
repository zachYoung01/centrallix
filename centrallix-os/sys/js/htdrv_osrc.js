// Copyright (C) 1998-2008 LightSys Technology Services, Inc.
//
// You may use these files and this library under the terms of the
// GNU Lesser General Public License, Version 2.1, contained in the
// included file "COPYING" or http://www.gnu.org/licenses/lgpl.txt.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Lesser General Public License for more details.

function osrc_init_query()
    {
    if(this.init==true)
	return;
    this.init=true;
    this.ifcProbe(ifAction).Invoke("QueryObject", {query:[], client:null, ro:this.readonly});
    }


function osrc_action_order_object(aparam) //order)
    {
    this.pendingorderobject=aparam.orderobj;
    this.ifcProbe(ifAction).Invoke("QueryObject", {query:this.queryobject, client:null, ro:this.readonly});
    }

function osrc_criteria_from_aparam(aparam)
    {
    var qo = [];
    var t;
    var v;
    qo.joinstring = 'AND';
    for (var i in aparam)
	{
	if (i == 'cx__enable_lists') continue;
	if (i == 'cx__case_insensitive') continue;
	if (i == 'joinstring' && (new String(aparam[i])).toLowerCase() == 'or')
	    {
	    qo.joinstring = 'OR';
	    continue;
	    }
	v = aparam[i];
	if (i == '_Origin' || i == '_EventName') continue;
	if (typeof v == 'string' && (new String(v)).indexOf(',') > 0 && aparam.cx__enable_lists)
	    {
	    t = 'stringarray';
	    v = (new String(v)).split(/,/);
	    }
	else if ((typeof v == 'string' || (typeof v == 'object' && v != null && v.constructor == String)) && aparam.cx__case_insensitive)
	    t = 'istring';
	else if (typeof v == 'string' || (typeof v == 'object' && v != null && v.constructor == String))
	    t = 'string';
	else if (typeof v == 'number')
	    t = 'integer';
	else
	    t = 'string';
	qo.push({oid:i, value:v, type:t});
	}
    return qo;
    }

function osrc_action_query_param(aparam)
    {
    if (this.query_delay_schedid)
	{
	pg_delsched(this.query_delay_schedid);
	this.query_delay_schedid = null;
	}
    var qo = osrc_criteria_from_aparam(aparam);
    this.ifcProbe(ifAction).Invoke("QueryObject", {query:qo, client:null, ro:this.readonly});
    }


function osrc_action_refresh(aparam)
    {
    var tr = this.CurrentRecord;
    if (!tr || tr < 1) tr = 1;
    this.ifcProbe(ifAction).Invoke("QueryObject", {query:this.queryobject, client:null, ro:this.readonly, targetrec:tr});
    }


function osrc_action_change_source(aparam)
    {
    if (!this.baseobj) return null;
    if (!aparam.Source) return null;
    var l = (new String(this.baseobj)).length;
    var s = new String(this.sql);
    var p = s.indexOf(this.baseobj);
    if (p >= 0)	
	this.sql = s.substr(0,p) + aparam.Source + s.substr(p+l);
    var s = new String(this.query);
    var p = s.indexOf(this.baseobj);
    if (p >= 0)	
	this.query = s.substr(0,p) + aparam.Source + s.substr(p+l);
    this.baseobj = aparam.Source;
    if (typeof aparam.Refresh == 'undefined' || aparam.Refresh)
	this.ifcProbe(ifAction).Invoke("Refresh", {});
    }


function osrc_action_query_object(aparam) //q, formobj, readonly)
    {
    if (this.query_delay_schedid)
	{
	pg_delsched(this.query_delay_schedid);
	this.query_delay_schedid = null;
	}
    this.QueueRequest({Request:'QueryObject', Param:aparam});
    this.Dispatch();
    }

function osrc_query_object_handler(aparam)
    {
    var formobj = aparam.client;
    var q = aparam.query;
    var readonly = aparam.ro;
    var appendrows = (aparam.cx__appendrows)?true:false;
    if (typeof aparam.cx__appendrows != 'undefined')
	delete aparam.cx__appendrows;
    var params = [];
    var filter = [];

    if(this.pending)
	{
	alert('There is already a query or movement in progress...');
	return 0;
	}

    this.move_target = aparam.targetrec;

    if (typeof q != 'undefined' && q !== null) this.ApplyRelationships(q, false);

    for(var i in q)
	{
	if (i == 'joinstring')
	    filter.joinstring = q.joinstring;
	else if (i == 'oid')
	    filter.oid = q.oid;
	else if (this.params[q[i].oid])
	    params.push(q[i]);
	else
	    filter.push(q[i]);
	}
    if (!filter.joinstring)
	filter.joinstring = 'AND';
   
    for(var pn in this.params)
	{
	var found = false;
	for(var i in params)
	    {
	    if (params[i].oid == pn && typeof params[i].value != 'undefined')
		{
		found = true;
		this.params[pn].pwgt.ifcProbe(ifAction).Invoke("SetValue", {Value:params[i].value});
		break;
		}
	    }
	if (!found)
	    {
	    this.params[pn].pwgt.ifcProbe(ifAction).Invoke("SetValue", {Value:null});
	    }
	}

    if (!aparam.fromsync)
	this.SyncID = osrc_syncid++;

    var sel_re = /^\s*(set\s+rowcount\s+[0-9]+\s+)?select\s+/i;
    var is_select = sel_re.test(this.sql);

    this.pendingqueryobject=q;
    var statement=this.sql;

    if (this.use_having)
	var sep = ' HAVING ';
    else
	var sep = ' WHERE ';
    var firstone=true;
    
    if(this.filter)
	{
	statement+= (sep + '('+this.filter+')');
	firstone=false;
	}
    if(filter && filter.joinstring && filter[0])
	{
	var filt = this.MakeFilter(filter);
	if (filt)
	    {
	    if(firstone)
		statement+=sep;
	    else
		statement+=' '+q.joinstring+' ';
	    statement+=filt;
	    }
	}
    
    firstone=true;
    if(this.pendingorderobject && is_select)
	for(var i in this.pendingorderobject)
	    {
	    if(firstone)
		{
		statement+=' ORDER BY '+this.pendingorderobject[i];
		firstone=false;
		}
	    else
		{
		statement+=', '+this.pendingorderobject[i];
		}
	    }
    if (!readonly && is_select)
	statement += ' FOR UPDATE'
    this.ifcProbe(ifAction).Invoke("Query", {query:statement, client:formobj, appendrows:appendrows});
    }


function osrc_make_filter_integer(col,val)
    {
    if (val == null)
	return ':"' + col.oid + '" is null ';
    else if (typeof val != 'number' && (new String(val)).search(/-/)>=0)
	{
	var parts = (new String(val)).split(/-/);
	return '(:"' + col.oid + '">=' + parts[0] + ' AND :"' + col.oid + '"<=' + parts[1] + ')';
	}
    else
	return ':"' + col.oid + '" = ' + val;
    }


function osrc_make_filter_string(col, val, icase)
    {
    var str = '';
    var ifunc = '';
    if (icase)
	ifunc = 'upper';
    if (val == null)
	str=':"'+col+'" is null ';
    else
	if (val.search(/^\*.+\*$/)>=0)
	    {
	    str='charindex(' + ifunc + '("'+val.substring(1,val.length-1)+'"),' + ifunc + '(:"'+col+'"))>0';
	    }
	else if(val.search(/^\*/)>=0) //* at beginning
	    {
	    val = val.substring(1); //pop off *
	    str='right(' + ifunc + '(:"'+col+'"),'+val.length+')=' + ifunc + '("'+val+'")';
	    }
	else if(val.search(/\*$/)>=0) //* at end
	    {
	    val=val.substring(0,val.length-1); //chop off *
	    str='substring(' + ifunc + '(:"'+col+'"),'+1+','+val.length+')=' + ifunc + '("'+val+'")';
	    }
	else if(val.indexOf('*')>=0) //* in middle
	    {
	    var ind = val.indexOf('*');
	    var val1 = val.substring(0,ind);
	    var val2 = val.substring(ind+1);
	    str='(right(' + ifunc + '(:"'+col+'"),'+val2.length+')=' + ifunc + '("'+val2+'")';
	    str+=' AND ';
	    str+='substring(' + ifunc + '(:"'+col+'"),1,'+val1.length+')=' + ifunc + '("'+val1+'"))';
	    }
	else
	    str=ifunc + '(:"'+col+'")='+ifunc+'("'+val+'")';
    return str;
    }
    

function osrc_make_filter(q)
    {
    var firstone=true;
    var statement='';
    var isnot;
    for(var i in q)
	{
	isnot = false;
	if(i!='oid' && i!='joinstring')
	    {
	    var str;
	    if(q[i].joinstring)
		{
		str=this.MakeFilter(q[i]);
		}
	    else
		{
		var val=q[i].value;
		//if (val == null) continue;

		if (typeof val == 'string')
		    val = new String(val);

		if (val && val.substring && val.substring(0,1) == '~')
		    {
		    val = val.substring(1);
		    isnot = true;
		    }
		else if (val && val.length && val[0] && val[0].substring && val[0].substring(0,1) == '~')
		    {
		    val[0] = val[0].substring(1);
		    isnot = true;
		    }

		if (q[i].type == "undefined" && this.type_list[q[i].oid])
		    q[i].type = this.type_list[q[i].oid];

		switch(q[i].type)
		    {
		    case 'integer':
			str = this.MakeFilterInteger(q[i], val);
			break;

		    case 'integerarray':
			if (val == null)
			    str = ':"' + q[i].oid + '" is null ';
			else if (val.length)
			    {
			    str = "(";
			    for(var j=0;j<val.length;j++)
				{
				if (j) str += " OR ";
				str += "(";
				str += this.MakeFilterInteger(q[i], val[j]);
				str += ")";
				}
			    str += ")";
			    }
			break;
		    case 'undefinedarray':
			if (val == null)
			    {
			    str=':"'+q[i].oid+'" is null ';
			    }
			else if (val.length == 0)
			    {
			    continue;
			    }
			else
			    {
			    str = "(";
			    for(var j=0;j<val.length;j++)
				{
				if (j) str += " OR ";
				str += "(";
				if ((new String(parseInt(val[j]))) == (new String(val[j])))
				    str += this.MakeFilterInteger(q[i], val[j]);
				else
				    str += this.MakeFilterString(q[i].oid, val[j]);
				str += ")";
				}
			    str += ")";
			    }
			break;
		    case 'stringarray':
			if (val == null)
			    {
			    str=':"'+q[i].oid+'" is null ';
			    }
			else
			    {
			    str = "(";
			    for(var j=0;j<val.length;j++)
				{
				if (j) str += " OR ";
				str += "(";
				str += this.MakeFilterString(q[i].oid, val[j]);
				str += ")";
				}
			    str += ")";
if (0) {
			    if (val[0].search(/^\*.+\*$/)>=0)
				{
				str='(charindex("'+val[0].substring(1,val[0].length-1)+'",:'+q[i].oid+')>0';
				}
			    else if(val[0].search(/^\*/)>=0) //asterisk at beginning
				{
				val[0] = val[0].substring(1); //pop off *
				str='(right(:'+q[i].oid+','+val[0].length+')="'+val[0]+'"';
				}
			    else if(val[0].search(/\*$/)>=0) //asterisk at end
				{
				val[0]=val[0].substring(0,val[0].length-1); //chop off *
				str='(substring(:'+q[i].oid+','+1+','+val[0].length+')="'+val[0]+'"';
				}
			    else if(val[0].indexOf('*')>=0) // * in middle
				{
				var ind = val[0].indexOf('*');
				var val1 = val[0].substring(0,ind);
				var val2 = val[0].substring(ind+1);
				str='((right(:'+q[i].oid+','+val2.length+')="'+val2+'"';
				str+=' AND ';
				str+='substring(:'+q[i].oid+',1,'+val1.length+')="'+val1+'")';
				}
			    else
				str='(:'+q[i].oid+'='+'"'+val[0]+'"';

			    for(var j=1;j<val.length;j++)
				{
				if (val[j].search(/^\*.+\*$/)>=0)
				    {
				    str+=' OR charindex("'+val[j].substring(1,val[j].length-1)+'",:'+q[i].oid+')>0';
				    }
				else if(val[j].search(/^\*/)>=0) // * at beginning
				    {
				    val[j] = val[j].substring(1); //pop off *
				    str+=' OR right(:'+q[i].oid+','+val[j].length+')="'+val[j]+'"';
				    }
				else if(val[j].search(/\*$/)>=0) // * at end
				    {
				    val[j]=val[j].substring(0,val[j].length-1); //chop off *
				    str+=' OR substring(:'+q[i].oid+','+1+','+val[j].length+')="'+val[j]+'"';
				    }
				else if(val[j].indexOf('*')>=0) // * in middle
				    {
				    var ind = val[j].indexOf('*');
				    var val1 = val[j].substring(0,ind);
				    var val2 = val[j].substring(ind+1);
				    str+=' OR (right(:'+q[i].oid+','+val2.length+')="'+val2+'"';
				    str+=' AND ';
				    str+='substring(:'+q[i].oid+',1,'+val1.length+')="'+val1+'")';
				    }
				else
				    str+=' OR :'+q[i].oid+'='+'"'+val[j]+'"';
				}
			    str+=')';
}
			    }
			break;
		    case 'datetimearray':
			str='(:'+q[i].oid;
			var dtfirst=true;
			for(var j in val)
			    {
			    if(!dtfirst) str+= ' AND :"' + q[i].oid + '"';
			    dtfirst=false;
			    if(val[j].substring(0,2)=='>=')
				str+=' >= \"'+val[j].substring(2)+'\"';
			    else if(val[j].substring(0,2)=='<=')
				str+=' <= \"'+val[j].substring(2)+'\"';
			    else if(val[j].substring(0,2)=='=>')
				str+=' >= \"'+val[j].substring(2)+'\"';
			    else if(val[j].substring(0,2)=='=<')
				str+=' <= \"'+val[j].substring(2)+'\"';
			    else if(val[j].substring(0,1)=='>')
				str+=' > \"'+val[j].substring(1)+'\"';
			    else if(val[j].substring(0,1)=='<')
				str+=' < \"'+val[j].substring(1)+'\"';
			    else if(val[j].substring(0,1)=='=')
				str+=' = \"'+val[j].substring(1)+'\"';
			    }
			str+=')';
			break;

		    case 'string':
		    case 'istring':
			str = this.MakeFilterString(q[i].oid, val, q[i].type == 'istring');
			break;

		    default:
			//htr_alert(val, 1);
			if(!val || typeof val.substring == 'undefined') // assume integer
			    str = this.MakeFilterInteger(q[i], val);
			else if(val.substring(0,2)=='>=')
			    str=':"'+q[i].oid+'" >= '+val.substring(2);
			else if(val.substring(0,2)=='<=')
			    str=':"'+q[i].oid+'" <= '+val.substring(2);
			else if(val.substring(0,2)=='=>')
			    str=':"'+q[i].oid+'" >= '+val.substring(2);
			else if(val.substring(0,2)=='=<')
			    str=':"'+q[i].oid+'" <= '+val.substring(2);
			else if(val.substring(0,1)=='>')
			    str=':"'+q[i].oid+'" > '+val.substring(1);
			else if(val.substring(0,1)=='<')
			    str=':"'+q[i].oid+'" < '+val.substring(1);
			else if(val.indexOf('-')>=0)
			    {
			    //assume integer range in string
			    var ind = val.indexOf('-');
			    var val1 = val.substring(0,ind);
			    var val2 = val.substring(ind+1);
			    str='(:"'+q[i].oid+'">='+val1+' AND :"'+q[i].oid+'"<='+val2+')';
			    }
			else
			    {
			    str = this.MakeFilterString(q[i].oid, val);
			    }
			break;
		    }
		}
	    if (isnot)
		str = "not (" + str + ")";
	    if(firstone)
		{
		statement+=' ('+str+')';
		}
	    else
		{
		statement+=' '+q.joinstring+' ('+str+')';
		}
	    firstone=false;
	    }
	}
    return statement;
    }


// This function sees if any children are 'unsure' or have unsaved
// data. This function could be called right before closing a window
// where nogo_func would be a confirmation box (to lose unsaved data
// or not) could appear if needed.
function osrc_go_nogo(go_func, nogo_func)
    {
    this._unsaved_cnt = 0;
    this._go_nogo_pending = true;
    this._go_func = go_func;
    this._nogo_func = nogo_func;

    // First, take inventory of how many unsaved or unsure children
    // are out there.
    for(var i in this.child)
	{
	if ((typeof this.child[i].IsUnsaved) == 'undefined' || this.child[i].IsUnsaved == true)
	    {
	    this._unsaved_cnt++;
	    this.child[i]._osrc_ready = false;
	    }
	else
	    {
	    this.child[i]._osrc_ready = true;
	    }
	}

    // Now check with each, give it a chance to save its data
    for(var i in this.child)
	{
	if (this.child[i]._osrc_ready == false)
	    {
	    if (this.child[i].IsDiscardReady() == true)
		this._unsaved_cnt--;

	    // Somebody already did a QueryCancel?
	    if (!this._go_nogo_pending) break;
	    }
	}

    // If none were unsaved or all have given the "go", then go ahead
    // and perform the originally desired operation, otherwise wait on
    // callbacks with QueryContinue or QueryCancel.
    if (this._unsaved_cnt == 0 && this._go_nogo_pending)
	{
	this._go_nogo_pending = false;
	this._go_func();
	}
    }


function osrc_action_query(aparam) //q, formobj)
    {
    if (this.query_delay_schedid)
	{
	pg_delsched(this.query_delay_schedid);
	this.query_delay_schedid = null;
	}
    this.QueueRequest({Request:'Query', Param:aparam});
    this.Dispatch();
    }

function osrc_query_handler(aparam)
    {
    var q = aparam.query;
    var formobj = aparam.client;

    if(this.pending)
	{
	alert('There is already a query or movement in progress...');
	return 0;
	}
    this.do_append = aparam.appendrows?true:false;
    this.lastquery=q;
    this.pendingquery=q;
    this.pending=true;

    // Check if any children are modified and call IsDiscardReady if they are
    this.GoNogo(osrc_cb_query_continue_2, osrc_cb_query_cancel_2);
    }

function osrc_action_delete(aparam) //up,formobj)
    {
    var up = aparam.data;
    var formobj = aparam.client;

    //Delete an object through OSML
    //var src = this.baseobj + '?cx__akey='+akey+'&ls__mode=osml&ls__req=delete&ls__sid=' + this.sid + '&ls__oid=' + up.oid;
    this.formobj = formobj;
    this.deleteddata=up;
    this.DoRequest('delete', this.baseobj, {ls__oid:up.oid}, osrc_action_delete_cb);
    //this.formobj.ObjectDeleted();
    //this.formobj.OperationComplete();
    return 0;
    }

function osrc_action_delete_cb()
    {
    var links = pg_links(this);
    if(links && links[0] && links[0].target != 'ERR')
	{
	var recnum=this.CurrentRecord;
	var cr=this.replica[recnum];
	if(cr)
	    {
	    // Remove the deleted row
	    delete this.replica[recnum];

	    // Adjust replica row id's to fill up the 'hole'
	    for(var i=recnum; i<this.LastRecord; i++)
		{
		this.replica[i] = this.replica[i+1];
		this.replica[i].id = i;
		}
	    delete this.replica[this.LastRecord];
	    this.LastRecord--;
	    if (this.OSMLRecord > 0) this.OSMLRecord--;

	    // Notify osrc clients (forms/tables/etc)
	    for(var i in this.child)
		this.child[i].ObjectDeleted(recnum);

	    // Need to fetch another record (delete was on last one in replica)?
	    if (this.CurrentRecord > this.LastRecord)
		{
		this.CurrentRecord--;
		this.MoveToRecord(this.CurrentRecord+1, true);
		}
	    else
		{
		this.MoveToRecord(this.CurrentRecord, true);
		}
	    }
	if (this.formobj) this.formobj.OperationComplete(true);
	}
    else
	{
	// delete failed
	if (this.formobj) this.formobj.OperationComplete(false);
	}
    this.formobj=null;
    delete this.deleteddata;
    return 0;
    }

function osrc_action_create(aparam)
    {
    var newobj = [];
    for(var p in aparam)
	newobj.push({oid:p, value:aparam[p]});
    this.ifcProbe(ifAction).Invoke("CreateObject", {client:null, data:newobj});
    }

function osrc_action_create_object(aparam) //up,formobj)
    {
    var up = aparam.data;
    var formobj = aparam.client;

    this.formobj=formobj;
    this.createddata=up;
    //First close the currently open query
    if(this.qid)
	{
	this.DoRequest('queryclose', '/', {ls__qid:this.qid}, osrc_action_create_cb2);
	this.qid=null;
	return 0;
	}
    else if (!this.sid)
	{
	this.replica = [];
	this.LastRecord=0;
	this.FirstRecord=1;
	this.CurrentRecord=1;
	this.OpenSession(this.CreateCB2);
	return 0;
	}
    this.CreateCB2();
    return 0;
    }

function osrc_action_create_cb2()
    {
    //Create an object through OSML
    if(!this.sid) this.sid=pg_links(this)[0].target;
    //var src = this.baseobj + '/*?cx__akey='+akey+'&ls__mode=osml&ls__req=create&ls__reopen_sql=' + htutil_escape(this.sql) + '&ls__sid=' + this.sid;
    this.ApplyRelationships(this.createddata, true);
    //htr_alert(this.createddata, 2);
    /*for(var i in this.createddata) if(i!='oid')
	{
	if (this.createddata[i]['value'] == null)
	    src+='&'+htutil_escape(this.createddata[i]['oid'])+'=';
	else
	    src+='&'+htutil_escape(this.createddata[i]['oid'])+'='+htutil_escape(this.createddata[i]['value']);
	}*/
    var reqparam = {ls__reopen_sql:this.sql, ls__sqlparam:this.EncodeParams()};
    for(var i in this.createddata) if(i!='oid')
	{
	if (this.createddata[i]['value'] == null)
	    reqparam[this.createddata[i]['oid']] = '';
	else
	    reqparam[this.createddata[i]['oid']] = this.createddata[i]['value'];
	}
    this.DoRequest('create', this.baseobj + '/*', reqparam, osrc_action_create_cb);
    }

function osrc_action_create_cb()
    {
    var links = pg_links(this);
    if(links && links[0] && links[0].target != 'ERR')
	{
	this.LastRecord++;
	this.CurrentRecord = this.LastRecord;
	var recnum=this.CurrentRecord;
	var cr=this.replica[this.CurrentRecord];
	if(!cr) cr = [];

	for(var i in this.createddata) // update replica
	    {
	    /*for(var j in cr)
		if(cr[j].oid==this.createddata[i].oid)
		    cr[j].value=this.createddata[i].value;*/
	    cr[i] = [];
	    cr[i].oid = this.createddata[i].oid;
	    cr[i].value = this.createddata[i].value;
	    cr[i].id = i;
	    }
	cr.oid = links[0].target;
	this.replica[this.CurrentRecord] = cr;

	// Check new/corrected data provided by server
	var server_rec = this.ParseOneRow(links, 1);
	var max_j = 0;
	for(var i in server_rec)
	    {
	    found = 0;
	    for(var j in cr)
		{
		if (j == 'oid') continue;
		if (cr[j].oid == server_rec[i].oid)
		    {
		    cr[j].value = server_rec[i].value;
		    cr[j].type = server_rec[i].type;
		    cr[j].hints = server_rec[i].hints;
		    found = 1;
		    }
		if (parseInt(j) > max_j) max_j = parseInt(j);
		}
	    if (!found)
		{
		max_j++;
		cr[max_j] = {};
		cr[max_j].oid = server_rec[i].oid;
		cr[max_j].value = server_rec[i].value;
		cr[max_j].type = server_rec[i].type;
		cr[max_j].id = max_j;
		cr[max_j].hints = server_rec[i].hints;
		}
	    }

	//alert(this.replica[this.CurrentRecord].oid);
	this.SyncID = osrc_syncid++;
	if (this.formobj) this.formobj.OperationComplete(true);
	for(var i in this.child)
	    this.child[i].ObjectCreated(recnum);
	this.GiveAllCurrentRecord();
	this.ifcProbe(ifEvent).Activate("Created", {});
	}
    else
	{
	if (this.formobj) this.formobj.OperationComplete(false);
	}
    this.formobj=null;
    delete this.createddata;
    }

function osrc_action_modify(aparam) //up,formobj)
    {
    if (aparam)
	{
	this.modifieddata = aparam.data;
	this.formobj = aparam.client;
	}

    // Need to close an open query first?
    if(this.qid)
	{
	this.DoRequest('queryclose', '/', {ls__qid:this.qid}, osrc_action_modify);
	this.qid=null;
	return 0;
	}
    //Modify an object through OSML
    //up[adsf][value];
    var reqparam = {ls__oid:this.modifieddata.oid};
    //var src='/?cx__akey='+akey+'&ls__mode=osml&ls__req=setattrs&ls__sid=' + this.sid + '&ls__oid=' + this.modifieddata.oid;
    this.ApplyRelationships(this.modifieddata, false);
    for(var i in this.modifieddata) if(i!='oid')
	{
	reqparam[this.modifieddata[i]['oid']] = this.modifieddata[i]['value'];
	//src+='&'+htutil_escape(this.modifieddata[i]['oid'])+'='+htutil_escape(this.modifieddata[i]['value']);
	}
    this.DoRequest('setattrs', '/', reqparam, osrc_action_modify_cb);
    }

function osrc_action_modify_cb()
    {
    var links = pg_links(this);
    var success = links && links[0] && (links[0].target != 'ERR');
    if(success)
	{
	var recnum=this.CurrentRecord;
	var cr=this.replica[this.CurrentRecord];
	if(cr)
	    for(var i in this.modifieddata) // update replica
		for(var j in cr)
		    if(cr[j].oid==this.modifieddata[i].oid)
			cr[j].value=this.modifieddata[i].value;

	// Check new/corrected data provided by server
	var server_rec = this.ParseOneRow(links, 1);
	var diff = 0;
	for(var i in server_rec)
	    for(var j in cr)
		{
		if (cr[j].oid == server_rec[i].oid && cr[j].value != server_rec[i].value)
		    {
		    cr[j].value = server_rec[i].value;
		    cr[j].type = server_rec[i].type;
		    diff = 1;
		    //alert(cr[j].value + " != " + server_rec[i].value);
		    }
		}
	
	this.SyncID = osrc_syncid++;
	if (this.formobj) this.formobj.OperationComplete(true);
	for(var i in this.child)
	    this.child[i].ObjectModified(recnum, this.replica[this.CurrentRecord]);
	if (diff)
	    this.GiveAllCurrentRecord();
	}
    else
	{
	if (this.formobj) this.formobj.OperationComplete(false);
	}
    this.formobj=null;
    delete this.modifieddata;
    }

function osrc_cb_query_continue(o)
    {
    //if there is no pending query, don't save the status
    //  this is here to protect against form1 vetoing the move, then form2 reporting it is ready to go
    //if(!this.pending) return 0;
    //Current form ready
    //if(o)
    //	o._osrc_ready = true;
    if (o && o._osrc_ready == false)
	{
	o._osrc_ready = true;
	this._unsaved_cnt--;
	if (this._unsaved_cnt <= 0 && this._go_nogo_pending)
	    {
	    this._go_nogo_pending = false;
	    this._go_func();
	    }
	}
    //If all other forms are ready then go
    //for(var i in this.child)
//	 {
//	 if(this.child[i]._osrc_ready == false)
//	      {
//	      return 0;
//	      }
//	 }
    }


function osrc_cb_query_continue_2()
    {
    //everyone looks ready, let's go
    this.init=true;
    if(this.pendingquery) // this could be a movement or a new query....
	{  // new query
	this.query=this.pendingquery;
	this.queryobject=this.pendingqueryobject;
	this.orderobject=this.pendingorderobject;
	this.pendingquery=null;
	this.pendingqueryobject=null;
	this.pendingorderobject=null;
	/*for(var i in this.child)
	     {
	     this.child[i]._osrc_ready=false;
	     }*/

	if (!this.do_append) this.ClearReplica();
	this.moveop=true;

	this.OpenSession(this.OpenQuery);
	}
    else
	{ // movement
	this.MoveToRecordCB(this.RecordToMoveTo, true);
	this.RecordToMoveTo=null;
	}
    this.pending=false;
    this.Dispatch();
    }

function osrc_cb_query_cancel()
    {
    if (this._go_nogo_pending)
	{
	this._go_nogo_pending = false;
	this._nogo_func();
	}
    }

function osrc_cb_query_cancel_2()
    {
    this.pendingquery=null;
    this.pending=false;
    this.Dispatch();
    }

function osrc_cb_request_object(aparam)
    {
    return 0;
    }

function osrc_cb_set_view_range(client, startrec, endrec)
    {
    client.__osrc_viewrange = [startrec, endrec];
    return;
    }

function osrc_cb_register(client)
    {
    this.child.push(client);
    client.__osrc_osrc = this;
    client.__osrc_viewrange = null;
    if (typeof client.is_savable != 'undefined')
	{
	if (client.is_savable)
	    this.savable_client_count++;
	client.__osrc_savable_changed = osrc_cb_savable_changed;
	htr_watch(client, 'is_savable', '__osrc_savable_changed');
	}
    else if (typeof client.is_client_savable != 'undefined')
	{
	if (client.is_client_savable)
	    this.savable_client_count++;
	client.__osrc_savable_changed = osrc_cb_savable_changed;
	htr_watch(client, 'is_client_savable', '__osrc_savable_changed');
	}
    }

function osrc_cb_savable_changed(p,o,n)
    {
    var osrc = this.__osrc_osrc;
    if (o && !n)
	osrc.savable_client_count--;
    else if (!o && n)
	osrc.savable_client_count++;
    if (osrc.is_client_savable && osrc.savable_client_count == 0)
	osrc.is_client_savable = false;
    else if (!osrc.is_client_savable && osrc.savable_client_count > 0)
	osrc.is_client_savable = true;
    return n;
    }

function osrc_open_session(cb)
    {
    //Open Session
    //alert('open');
    if(this.sid)
	{
	this.__osrc_cb = cb;
	this.__osrc_cb();
	}
    else
	{
	this.DoRequest('opensession', '/', {}, cb);
	}
    }

function osrc_open_query()
    {
    //Open Query
    if(!this.sid)
	{
	var lnks = pg_links(this);
	if (!lnks || !lnks[0] || !lnks[0].target)
	    return false;
	this.sid=pg_links(this)[0].target;
	}
    if(this.qid)
	{
	this.DoRequest('queryclose', '/', {ls__qid:this.qid}, osrc_open_query);
	this.qid=null;
	return 0;
	}
    this.query_ended = false;
    this.DoRequest('multiquery', '/', {ls__autoclose_sr:'1', ls__autofetch:'1', ls__objmode:'0', ls__notify:this.request_updates, ls__rowcount:this.replicasize, ls__sql:this.query, ls__sqlparam:this.EncodeParams()}, osrc_get_qid);
    this.querysize = this.replicasize;
    }

function osrc_get_qid()
    {
    //return;
    var lnk = pg_links(this);
    if (lnk[0])
	this.qid=lnk[0].target;
    else
	this.qid = null;
    //confirm(this.baseobj + " ==> " + this.qid);
    if (!this.qid)
	{
	this.pending=false;
	this.move_target = null;
	this.GiveAllCurrentRecord();
	this.Dispatch();
	}
    else
	{
	this.query_delay = pg_timestamp() - this.request_start_ts;
	for(var i in this.child)
	    this.child[i].DataAvailable();
	if (this.move_target)
	    var tgt = this.move_target;
	else
	    var tgt = 1;
	this.move_target = null;
	if (lnk.length > 1)
	    {
	    // did an autofetch - we have the data already
	    if (!this.do_append) this.ClearReplica();
	    this.TargetRecord = [tgt,tgt];
	    this.CurrentRecord = tgt;
	    this.moveop = true;
	    this.FetchNext();
	    }
	else
	    {
	    // start the ball rolling for the fetch
	    //this.ifcProbe(ifAction).Invoke("First", {from_internal:true});
	    this.ifcProbe(ifAction).Invoke("FindObject", {ID:tgt, from_internal:true});
	    }
	}
    /** normally don't actually load the data...just let children know that the data is available **/
    }

function osrc_parse_one_attr(lnk)
    {
    var col = {type:lnk.hash.substr(1), oid:htutil_unpack(lnk.host), hints:lnk.search};
    this.type_list[col.oid] = col.type;
    switch(lnk.text.charAt(0))
	{
	case 'V': col.value = htutil_rtrim(unescape(lnk.text.substr(2))); break;
	case 'N': col.value = null; break;
	case 'E': col.value = '** ERROR **'; break;
	}
    return col;
    }


function osrc_new_replica_object(id, oid)
    {
    var obj = [];
    obj.oid=oid;
    obj.id = id;
    return obj;
    }

function osrc_prune_replica(most_recent_id)
    {
    if(this.LastRecord < most_recent_id)
	{
	this.LastRecord = most_recent_id;
	while(this.LastRecord-this.FirstRecord >= this.replicasize)
	    {
	    // don't go past current record
	    if (this.FirstRecord == this.CurrentRecord || this.FirstRecord == this.TargetRecord[0]) break;
	    var found = false;
	    for(var c in this.child)
		{
		if (this.child[c].__osrc_viewrange && this.FirstRecord == this.child[c].__osrc_viewrange[0])
		    {
		    found = true;
		    break;
		    }
		}
	    if (found) break;

	    // clean up replica
	    this.oldoids.push(this.replica[this.FirstRecord].oid);
	    delete this.replica[this.FirstRecord];
	    this.FirstRecord++;
	    }
	}
    if(this.FirstRecord > most_recent_id)
	{
	this.FirstRecord = most_recent_id;
	while(this.LastRecord-this.FirstRecord >= this.replicasize)
	    { 
	    // don't go past current record
	    if (this.LastRecord == this.CurrentRecord || this.LastRecord == this.TargetRecord[1]) break;
	    for(var c in this.child)
		{
		var found = false;
		if (this.child[c].__osrc_viewrange && this.LastRecord == this.child[c].__osrc_viewrange[1])
		    {
		    found = true;
		    break;
		    }
		}
	    if (found) break;

	    // clean up replica
	    if (this.replica[this.LastRecord])
		{
		this.oldoids.push(this.replica[this.LastRecord].oid);
		delete this.replica[this.LastRecord];
		}
	    this.LastRecord--;
	    }
	}
    }

function osrc_clear_replica()
    {
    this.TargetRecord = [1,1];/* the record we're aiming for -- go until we get it*/
    this.CurrentRecord=1;/* the current record */
    this.OSMLRecord=0;/* the last record we got from the OSML */

    /** Clear replica **/
    if(this.replica)
	for(var i in this.replica)
	    this.oldoids.push(this.replica[i].oid);
    
    if(this.replica) delete this.replica;
    this.replica = [];
    this.LastRecord=0;
    this.FirstRecord=1;
    }

function osrc_parse_one_row(lnk, i)
    {
    var row = [];
    var cnt = 0;
    var tgt = lnk[i].target;
    while(i < lnk.length && (lnk[i].target == tgt || lnk[i].target == 'R'))
	{
	row[cnt] = this.ParseOneAttr(lnk[i]);
	cnt++;
	i++;
	}
    return row;
    }

function osrc_do_fetch(rowcnt)
    {
    this.querysize = rowcnt?rowcnt:1;
    var reqparam = {ls__qid:this.qid, ls__objmode:'0', ls__notify:this.request_updates};
    if (rowcnt)
	reqparam.ls__rowcount = rowcnt;
    if (this.startat)
	reqparam.ls__startat = this.startat;
    if (this.query_delay_schedid)
	{
	pg_delsched(this.query_delay_schedid);
	this.query_delay_schedid = null;
	}
    this.DoRequest('queryfetch', '/', reqparam, osrc_fetch_next);
    }

function osrc_query_timeout()
    {
    var qid = this.qid;
    this.query_delay_schedid = null;
    if (qid)
	{
	this.qid = null;
	this.DoRequest('queryclose', '/', {ls__qid:qid}, osrc_close_query);
	}
    this.Dispatch();
    return 0;
    }

function osrc_end_query()
    {
    //this.formobj.OperationComplete(); /* don't need this...I think....*/
    var qid=this.qid
    this.qid=null;
    /* return the last record as the current one if it was our target otherwise, don't */
    if (this.LastRecord >= this.FirstRecord && this.replica[this.LastRecord])
	this.replica[this.LastRecord].__osrc_is_last = true;
    this.query_ended = true;
    /*if(this.moveop)
	{*/
	/*this.GiveAllCurrentRecord();
	}
    else
	{
	this.TellAllReplicaMoved();
	}
    this.pending=false;
    if(this.doublesync)
	this.DoubleSyncCB();*/
    this.FoundRecord();
    if(qid)
	{
	this.DoRequest('queryclose', '/', {ls__qid:qid}, osrc_close_query);
	}
    this.Dispatch();
    this.ifcProbe(ifEvent).Activate("EndQuery", {});
    return 0;
    }

function osrc_found_record()
    {
    if(this.CurrentRecord>this.LastRecord)
	this.CurrentRecord=this.LastRecord;
    if(this.doublesync)
	this.DoubleSyncCB();
    if(this.moveop)
	this.GiveAllCurrentRecord();
    else
	this.TellAllReplicaMoved();
    this.pending=false;
    this.osrc_oldoid_cleanup();
    if (this.query_delay)
	{
	if (this.query_delay_schedid)
	    {
	    pg_delsched(this.query_delay_schedid);
	    this.query_delay_schedid = null;
	    }
	var d = this.query_delay * 2 + 1000;
	if (d < 3000) d = 3000;
	if (d > 30000) d = 30000;
	this.query_delay_schedid = pg_addsched_fn(this, 'QueryTimeout', [], d);
	}
    }

function osrc_fetch_next()
    {
    pg_debug(this.id + ": FetchNext() ==> " + pg_links(this).length + "\n");
    //alert('fetching....');
    if(!this.qid)
	{
	//if (pg_diag) confirm("ERR: " + this.baseobj + " ==> " + this.qid);
	if (pg_diag) confirm("fetch_next: error - no qid.  first/last/cur/osml: " + this.FirstRecord + "/" + this.LastRecord + "/" + this.CurrentRecord + "/" + this.OSMLRecord + "\n");
	//alert('something is wrong...');
	//alert(this.src);
	}
    var lnk=pg_links(this);
    var lc=lnk.length;
    //confirm(this.baseobj + " ==> " + lc + " links");
    if(lc < 2)
	{ // query over
	this.EndQuery();
	return 0;
	}
    var colnum=0;
    var i = 1;
    var rowcnt = 0;
    while (i < lc)
	{
	if (lnk[i].target == 'QUERYCLOSED')
	    {
	    this.qid = null;
	    break;
	    }
	this.OSMLRecord++; // this holds the last record we got, so now will hold current record number
	this.replica[this.OSMLRecord] =
		this.NewReplicaObj(this.OSMLRecord, lnk[i].target);
	this.PruneReplica(this.OSMLRecord);
	var row = this.ParseOneRow(lnk, i);
	rowcnt++;
	i += row.length;
	for(var j=0; j<row.length; j++)
	    {
	    this.replica[this.OSMLRecord][j] = row[j];
	    }
	}
    pg_debug("   Fetch returned " + rowcnt + " rows, querysize was " + this.querysize + ".\n");

    // make sure we bring this.LastRecord back down to the top of our replica...
    while(!this.replica[this.LastRecord] && this.LastRecord > 0)
	this.LastRecord--;

    if(this.LastRecord<this.TargetRecord[1])
	{ 
	// didn't get a full fetch?  end query if so
	if (rowcnt < this.querysize)
	    {
	    this.EndQuery();
	    return 0;
	    }

	// Wow - how many records does the user want?
	if ((this.LastRecord % 500) < ((this.LastRecord - this.querysize) % 500))
	    {
	    if (!confirm("You have already retrieved " + this.LastRecord + " records.  Do you want to continue?"))
		{
		// pause here.
		this.FoundRecord();
		return 0;
		}
	    }

	// We're going farther down this...
	this.DoFetch(this.readahead);
	}
    else
	{
	// we've got the one we need 
	if((this.LastRecord-this.FirstRecord+1)<this.replicasize && rowcnt >= this.querysize)
	    {
	    // make sure we have a full replica if possible
	    this.DoFetch(this.replicasize - (this.LastRecord - this.FirstRecord + 1));
	    }
	else
	    {
	    if (rowcnt < this.querysize)
		this.EndQuery();
	    else
		this.FoundRecord();
	    }
	}
    }

function osrc_oldoid_cleanup()
    {
    if(this.oldoids && this.oldoids[0])
	{
	this.pending=true;
	var src='';
	for(var i in this.oldoids)
	    src+=this.oldoids[i];
	if(this.sid)
	    this.DoRequest('close', '/', {ls__oid:src}, osrc_oldoid_cleanup_cb);
	else
	    alert('session is invalid');
	}
    else
	this.Dispatch();
    }
 
function osrc_oldoid_cleanup_cb()
    {
    this.pending=false;
    //alert('cb recieved');
    delete this.oldoids;
    this.oldoids = [];
    this.Dispatch();
    }
 
function osrc_close_query()
    {
    //Close Query
    this.qid=null;
    this.osrc_oldoid_cleanup();
    //confirm("closing " + this.baseobj);
    //this.onload = osrc_close_session;
    //pg_set(this,'src','/?ls__mode=osml&ls__req=queryclose&ls__qid=' + this.qid);
    }
 
function osrc_close_object()
    {
    //Close Object
    this.DoRequest('close', '/', {ls__oid:this.oid}, osrc_close_session);
    }
 
function osrc_close_session()
    {
    //Close Session
    this.DoRequest('closesession', '/', {}, osrc_oldoid_cleanup);
    this.qid=null;
    this.sid=null;
    }


function osrc_action_find_object(aparam)
    {
    var from_internal = (aparam.from_internal)?true:false;
    if (typeof aparam.ID != 'undefined')
	{
	// Find by record #
	var id = parseInt(aparam.ID);
	if (!id) id = 1;
	this.MoveToRecord(id, from_internal);
	}
    else if (typeof aparam.Name != 'undefined')
	{
	// Find by object name
	for(var i in this.replica)
	    {
	    var rec = this.replica[i];
	    for(var j in rec)
		{
		var col = rec[j];
		if (col.oid == 'name')
		    {
		    if (col.value == aparam.Name)
			this.MoveToRecord(i, from_internal);
		    break;
		    }
		}
	    }
	}
    else
	{
	// find arbitrarily
	if (aparam._Origin) delete aparam._Origin;
	if (aparam._EventName) delete aparam._EventName;
	for(var i in this.replica)
	    {
	    var rec = this.replica[i];
	    }
	}
    }


function osrc_move_first(aparam)
    {
    this.MoveToRecord(1, aparam.from_internal);
    }


function osrc_change_current_record()
    {
    var newprevcurrent = [];
    var fieldlistobj = this.prevcurrent;
    if (!fieldlistobj || fieldlistobj.length == 0)
	fieldlistobj = this.replica[this.CurrentRecord];
    if (!fieldlistobj || fieldlistobj.length == 0)
	return;

    for(var i in fieldlistobj)
	{
	if (typeof fieldlistobj[i] != 'object') continue;
	var attrname = fieldlistobj[i].oid;
	var oldval = null;
	var newval = null;
	if (this.prevcurrent)
	    {
	    for(var j in this.prevcurrent)
		{
		if (typeof this.prevcurrent[j] != 'object') continue;
		if (this.prevcurrent[j].oid == attrname)
		    {
		    oldval = this.prevcurrent[j].value;
		    break;
		    }
		}
	    }
	if (this.replica[this.CurrentRecord])
	    {
	    for(var j in this.replica[this.CurrentRecord])
		{
		if (typeof this.replica[this.CurrentRecord][j] != 'object') continue;
		if (this.replica[this.CurrentRecord][j].oid == attrname)
		    {
		    newval = this.replica[this.CurrentRecord][j].value;
		    break;
		    }
		}
	    }
	if (oldval != newval)
	    this.ifcProbe(ifValue).Changing(attrname, newval, true, oldval, true);
	if (newval)
	    newprevcurrent.push({oid:attrname, value:newval});
	}
    this.prevcurrent = newprevcurrent;
    }


function osrc_give_all_current_record()
    {
    //confirm('give_all_current_record start');
    /*for(var j in this.replica[this.CurrentRecord])
	{
	var col = this.replica[this.CurrentRecord][j];
	if (typeof col == 'object')
	    this.ifcProbe(ifValue).Changing(col.oid, col.value, true);
	}*/
    this.ChangeCurrentRecord();
    for(var i in this.child)
	this.child[i].ObjectAvailable(this.replica[this.CurrentRecord]);
    this.ifcProbe(ifEvent).Activate("DataFocusChanged", {});
    //confirm('give_all_current_record done');
    }

function osrc_tell_all_replica_moved()
    {
    //confirm('tell_all_replica_moved start');
    for(var i in this.child)
	if(this.child[i].ReplicaMoved)
	    this.child[i].ReplicaMoved();
    //confirm('tell_all_replica_moved done');
    }


function osrc_move_to_record(recnum, from_internal)
    {
    this.QueueRequest({Request:'MoveTo', Param:{recnum:recnum, from_internal:from_internal}});
    this.Dispatch();
    }

function osrc_move_to_record_handler(param)
    {
    var recnum = param.recnum;
    var from_internal = param.from_internal;
    if(recnum<1)
	{
	//alert("Can't move past beginning.");
	return 0;
	}
    if(this.pending)
	{
	//alert('you got ahead');
	return 0;
	}
    this.pending=true;
    //var someunsaved=false;
    this.RecordToMoveTo=recnum;
    if (!from_internal)
	this.SyncID = osrc_syncid++;
    this.GoNogo(osrc_cb_query_continue_2, osrc_cb_query_cancel_2);
    /*for(var i in this.child)
	 {
	 if(this.child[i].IsUnsaved)
	     {
	     //alert('child: '+i+' : '+this.child[i].IsUnsaved+' isn\\'t saved...IsDiscardReady');
	     this.child[i]._osrc_ready=false;
	     this.child[i].IsDiscardReady();
	     someunsaved=true;
	     }
	 else
	     {
	     this.child[i]._osrc_ready=true;
	     }
	 }*/
    //if someunsaved is false, there were no unsaved forms, so no callbacks
    //  we can just continue
    /*if(someunsaved) return 0;
    this.MoveToRecordCB(recnum);*/
    }

function osrc_move_to_record_cb(recnum)
    {
    pg_debug(this.id + ": MoveTo(" + recnum + ")\n");
    //confirm(recnum);
    this.moveop=true;
    if(recnum<1)
	{
	//alert("Can't move past beginning.");
	return 0;
	}
    this.RecordToMoveTo=recnum;
    for(var i in this.child)
	 {
	 if(this.child[i].IsUnsaved)
	     {
	     //confirm('child: '+i+' : '+this.child[i].IsUnsaved+' isn\\'t saved...');
	     return 0;
	     }
	 }
/* If we're here, we're ready to go */
    this.TargetRecord = [recnum, recnum];
    this.CurrentRecord = recnum;
    if(this.CurrentRecord <= this.LastRecord && this.CurrentRecord >= this.FirstRecord)
	{
	this.GiveAllCurrentRecord();
	this.pending=false;
	this.Dispatch();
	return 1;
	}
    else
	{
	if(this.CurrentRecord < this.FirstRecord)
	    { /* data is further back, need new query */
	    if(this.FirstRecord-this.CurrentRecord<this.readahead)
		{
		this.startat=(this.FirstRecord-this.readahead)>0?(this.FirstRecord-this.readahead):1;
		}
	    else
		{
		this.startat=this.CurrentRecord;
		}
	    if(this.qid)
		{
		this.DoRequest('queryclose', '/', {ls__qid:this.qid}, osrc_open_query_startat);
		}
	    else
		{
		this.osrc_open_query_startat();
		}
	    return 0;
	    }
	else
	    { /* data is farther on, act normal */
	    if(this.qid)
		{
		if(this.CurrentRecord == Number.MAX_VALUE)
		    {
		    /* rowcount defaults to a really high number if not set */
		    this.DoFetch(100);
		    }
		else if (recnum == 1)
		    {
		    // fill replica if empty
		    this.DoFetch(this.replicasize);
		    }
		else
		    {
		    this.DoFetch(this.readahead);
		    }
		}
	    else if (!this.query_ended)
		{
		this.startat = this.LastRecord + 1;
		this.osrc_open_query_startat();
		}
	    else
		{
		this.pending=false;
		this.CurrentRecord=this.LastRecord;
		this.GiveAllCurrentRecord();
		this.Dispatch();
		}
	    return 0;
	    }
	}
    }

function osrc_open_query_startat()
    {
    if(this.FirstRecord > this.startat && this.FirstRecord - this.startat < this.replicasize)
	this.querysize = this.FirstRecord - this.startat;
    else
	this.querysize = this.replicasize;
    this.query_ended = false;
    this.DoRequest('multiquery', '/', {ls__startat:this.startat, ls__autoclose_sr:1, ls__autofetch:1, ls__objmode:0, ls__notify:this.request_updates, ls__rowcount:this.querysize, ls__sql:this.query, ls__sqlparam:this.EncodeParams()}, osrc_get_qid_startat);
    }

function osrc_get_qid_startat()
    {
    var lnk = pg_links(this);
    this.qid=lnk[0].target;
    if (!this.qid)
	{
	this.startat = null;
	this.pending=false;
	this.GiveAllCurrentRecord();
	this.Dispatch();
	return;
	}
    this.OSMLRecord=this.startat-1;
    //this.FirstRecord=this.startat;
    /*if(this.startat-this.TargetRecord+1<this.replicasize)
	{
	this.DoFetch(this.TargetRecord - this.startat + 1);
	}*/
    if (lnk.length > 1)
	{
	// did an autofetch - we have the data already
	this.query_delay = pg_timestamp() - this.request_start_ts;
	this.FetchNext();
	}
    else
	{
	if(this.FirstRecord - this.startat < this.replicasize)
	    {
	    this.DoFetch(this.FirstRecord - this.startat);
	    }
	else
	    {
	    this.DoFetch(this.replicasize);
	    }
	}
    this.startat=null;
    }


function osrc_move_next(aparam)
    {
    this.MoveToRecord(this.CurrentRecord+1, false);
    }

function osrc_move_prev(aparam)
    {
    this.MoveToRecord(this.CurrentRecord-1, false);
    }

function osrc_move_last(aparam)
    {
    this.MoveToRecord(Number.MAX_VALUE, false); /* FIXME */
    //alert("do YOU know where the end is? I sure don't.");
    }


function osrc_scroll_prev()
    {
    if(this.FirstRecord!=1) this.ScrollTo(this.FirstRecord-1);
    }

function osrc_scroll_next()
    {
    this.ScrollTo(this.LastRecord+1);
    }

function osrc_scroll_prev_page()
    {
    this.ScrollTo(this.FirstRecord>this.replicasize?this.FirstRecord-this.replicasize:1);
    }

function osrc_scroll_next_page()
    {
    this.ScrollTo(this.LastRecord+this.replicasize);
    }

function osrc_scroll_to(startrec, endrec)
    {
    pg_debug(this.id + ": ScrollTo(" + startrec + "," + endrec + ")\n");
    pg_debug("   first/last/cur/osml: " + this.FirstRecord + "/" + this.LastRecord + "/" + this.CurrentRecord + "/" + this.OSMLRecord + "\n");
    this.moveop=false;
    this.TargetRecord = [startrec, endrec];
    this.SyncID = osrc_syncid++;
    if(this.TargetRecord[1] <= this.LastRecord && this.TargetRecord[0] >= this.FirstRecord)
	{
	this.TellAllReplicaMoved();
	this.pending=false;
	this.Dispatch();
	return 1;
	}
    else
	{
	if(this.TargetRecord[0] < this.FirstRecord)
	    {
	    /* data is further back, need new query */
	    if(this.FirstRecord-this.TargetRecord[0]<this.scrollahead)
		{
		this.startat=(this.FirstRecord-this.scrollahead)>0?(this.FirstRecord-this.scrollahead):1;
		}
	    else
		{
		this.startat=this.TargetRecord[0];
		}
	    if(this.qid)
		{
		this.DoRequest('queryclose', '/', {ls__qid:this.qid}, osrc_open_query_startat);
		}
	    else
		{
		this.osrc_open_query_startat();
		}
	    return 0;
	    }
	else
	    {
	    /* data is farther on, act normal */
	    if(this.qid)
		{
		if(this.TargetRecord[1] == Number.MAX_VALUE)
		    {
		    /* rowcount defaults to a really high number if not set */
		    this.DoFetch(100);
		    }
		else
		    {
		    /* need to increase replica size to accomodate? */
		    this.DoFetch(this.scrollahead);
		    }
		}
	    else if (!this.query_ended)
		{
		this.startat = this.LastRecord + 1;
		this.osrc_open_query_startat();
		}
	    else
		{
		this.pending=false;
		this.TargetRecord[1]=this.LastRecord;
		this.TellAllReplicaMoved();
		this.Dispatch();
		}
	    return 0;
	    }
	}
    }


function osrc_cleanup()
    {
/** this last-second page load is screwing something up... **/
/**   sometimes it will cause a blank page to be loaded, others it's a 'bus error' crash **/
    return 0;
    if(this.qid)
	{ /* why does the browser load a blank page when you try to move away? */
	this.onLoad=null;
	pg_set(this,'src',"/?cx__akey="+akey+"&ls__mode=osml&ls__req=queryclose&ls__sid="+this.sid+"&ls__qid="+this.qid);
	this.qid=null;
	}
    }

function osrc_action_sync(param)
    {
    this.parentosrc=param.ParentOSRC;
    if (!this.parentosrc) 
	this.parentosrc = wgtrGetNode(this, param._Origin);
    this.ParentKey = [];
    this.ChildKey = [];

    // Prevent sync loops
    if (this.SyncID == this.parentosrc.SyncID)
	{
	return;
	}
    this.SyncID = this.parentosrc.SyncID;

    // Compile the list of criteria
    var query = [];
    query.oid=null;
    query.joinstring='AND';
    var p=this.parentosrc.CurrentRecord;
    for(var i=1;i<10;i++)
	{
	//this.ParentKey[i]=eval('param.ParentKey'+i);
	//this.ChildKey[i]=eval('param.ChildKey'+i);
	this.ParentKey[i]=param['ParentKey'+i];
	this.ChildKey[i]=param['ChildKey'+i];
	if(this.ParentKey[i])
	    {
	    if (!this.parentosrc.replica[p])
		{
		var t = new Object();
		t.oid = this.ChildKey[i];
		t.value = null;
		t.type = 'integer'; // type doesn't matter if it is null.
		query.push(t);
		}
	    else
		{
		for(var j in this.parentosrc.replica[p])
		    {
		    if(this.parentosrc.replica[p][j].oid==this.ParentKey[i])
			{
			var t = new Object();
			t.oid=this.ChildKey[i];
			t.value=this.parentosrc.replica[p][j].value;
			t.type=this.parentosrc.replica[p][j].type;
			query.push(t);
			}
		    }
		}
	    }
	}

    // Did it change from last time?
    if (!this.lastSync)
	this.lastSync = [];
    var changed = false;
    for(var i=0;i<query.length;i++)
	{
	if (!this.lastSync[i])
	    {
	    changed = true;
	    }
	else if (this.lastSync[i].oid != query[i].oid || this.lastSync[i].value != query[i].value)
	    {
	    changed = true;
	    }
	this.lastSync[i] = {oid:query[i].oid, type:query[i].type, value:query[i].value};
	}
    for (var i=query.length;i<this.lastSync.length;i++)
	{
	this.lastSync[i] = {};
	}

    // Do the query
    if (changed)
	this.ifcProbe(ifAction).Invoke("QueryObject", {query:query, client:null,ro:this.readonly, fromsync:true});
    }

function osrc_action_double_sync(param)
    {
    this.doublesync=true;
    this.replicasize=100;
    this.readahead=100;
    this.parentosrc=param.ParentOSRC;
    this.childosrc=param.ChildOSRC;
    this.ParentKey = [];
    this.ParentSelfKey = [];
    this.SelfChildKey = [];
    this.ChildKey = [];
    var query = [];
    query.oid=null;
    query.joinstring='AND';
    var p=this.parentosrc.CurrentRecord;
    for(var i=1;i<10;i++)
	{
	this.ParentKey[i]=eval('param.ParentKey'+i);
	this.ParentSelfKey[i]=eval('param.ParentSelfKey'+i);
	this.SelfChildKey[i]=eval('param.SelfChildKey'+i);
	this.ChildKey[i]=eval('param.ChildKey'+i);
	if(this.ParentKey[i])
	    {
	    for(var j in this.parentosrc.replica[p])
		{
		if(this.parentosrc.replica[p][j].oid==this.ParentKey[i])
		    {
		    var t = new Object();
		    t.oid=this.ParentSelfKey[i];
		    t.value=this.parentosrc.replica[p][j].value;
		    t.type=this.parentosrc.replica[p][j].type;
		    query.push(t);
		    }
		}
	    }
	}
    this.ifcProbe(ifAction).Invoke("QueryObject", {query:query, client:null, ro:this.readonly, fromsync:true});
    }

function osrc_action_double_sync_cb()
    {
    var query = [];
    query.oid=null;
    query.joinstring='OR';
    if(this.LastRecord==0)
	{
	var t = new Object();
	t.oid=1;
	t.value=2;
	t.type='integer';
	query.push(t);
	}
    for(var p=this.FirstRecord; p<=this.LastRecord; p++)
	{
	var q = [];
	q.oid=null;
	q.joinstring='AND';
	for(var i=1;i<10;i++)
	    {
	    if(this.SelfChildKey[i])
		{
		for(var j in this.replica[p])
		    {
		    if(this.replica[p][j].oid==this.SelfChildKey[i])
			{
			var t = new Object();
			t.oid=this.ChildKey[i];
			t.value=this.replica[p][j].value;
			t.type=this.replica[p][j].type;
			q.push(t);
			}
		    }
		}
	    }
	query.push(q);
	}
    
    this.doublesync=false;
    this.childosrc.ifcProbe(ifAction).Invoke("QueryObject", {query:query, client:null, ro:this.readonly});
    }


// for each value in the replica, run a SQL statement
function osrc_action_do_sql(aparam)
    {
    if (!this.do_sql_loader)
	{
	this.do_sql_loader = htr_new_loader(this);
	this.do_sql_loader.osrc = this;
	}

    if (!aparam.SQL) return;
    this.do_sql_query = aparam.SQL;

    var p = aparam;
    if (p._Origin) delete p._Origin;
    if (p._EventName) delete p._EventName;
    delete p.SQL;

    this.do_sql_field = aparam.GroupingField;
    this.do_sql_used_values = {};
    this.do_sql_params = p;

    this.osrc_action_do_sql_cb();
    }


// Called when do_sql command is complete.
function osrc_action_do_sql_cb()
    {
    var osrc = (this.osrc)?(this.osrc):this;

    var grp_value = null;
    var common_values = {};
    var found_first = false;
    var attrval;
    for(var i in osrc.replica)
	{
	var obj = osrc.replica[i];
	if (typeof osrc.do_sql_field != 'undefined')
	    {
	    for(var j in obj)
		{
		var attr = obj[j];
		if (attr.oid == osrc.do_sql_field)
		    {
		    attrval = attr.value;
		    if (typeof osrc.do_sql_used_values[attr.value] != 'undefined')
			{
			grp_value = attr.value;
			osrc.do_sql_used_values[grp_value] = true;
			}
		    break;
		    }
		}
	    }
	if ((grp_value !== null && grp_value == attrval) || typeof osrc.do_sql_field == 'undefined')
	    {
	    for(var j in obj)
		{
		var attr = obj[j];
		if (!found_first)
		    common_values[attr.oid] = attr.value;
		else if (common_values[attr.oid] != attr.value)
		    delete common_values[attr.oid];
		}
	    found_first = true;
	    }
	}

    // no more data to do?
    if (!found_first) return;

    // copy in aparam values -- overrides common_values
    for (var p in osrc.do_sql_params)
	{
	common_values[p] = osrc.do_sql_params[p];
	}

    // run the request and wait for the callback.
    osrc.DoRequest('multiquery', '/', {ls__autoclose:'1', ls__autofetch:'1', ls__objmode:'0', ls__notify:0, ls__sql:osrc.do_sql_query, ls__sqlparam:osrc.Encode(common_values)}, osrc_action_do_sql_cb, osrc.do_sql_loader);
    }


/** called by child to get a template to build a new object for creation **/
function osrc_cb_new_object_template()
    {
    var obj = this.NewReplicaObj(0, 0);

    this.ApplyRelationships(obj, false);
    this.ApplyKeys(obj);

    return obj;
    }

function osrc_apply_keys(obj)
    {
    var cnt = 0;
    while(typeof obj[cnt] != 'undefined') cnt++;

    for(var i in this.rulelist)
	{
	var rl = this.rulelist[i];
	if (rl.ruletype == 'osrc_key')
	    {
	    switch(rl.keying_method)
		{
		case 'counterosrc':
		    if (rl.osrc.CurrentRecord && rl.osrc.replica && rl.osrc.replica[rl.osrc.CurrentRecord])
			{
			var pobj = rl.osrc.replica[rl.osrc.CurrentRecord];
			for(var j in pobj)
			    {
			    var col = pobj[j];
			    if (typeof col == 'object' && col.oid == rl.counter_attribute)
				{
				var found = false;
				for(var l in obj)
				    {
				    if (obj[l] == null || typeof obj[l] != 'object') continue;
				    if (obj[l].oid == rl.key_fieldname)
					{
					found = true;
					obj[l] = {type:col.type, value:col.value, hints:col.hints, oid:rl.key_fieldname};
					}
				    }
				if (!found)
				    obj[cnt++] = {type:col.type, value:col.value, hints:col.hints, oid:rl.key_fieldname};

				var nobj = [];
				nobj.oid = pobj.oid;
				nobj.push({value:parseInt(pobj[j].value?pobj[j].value:0) + 1, type:pobj[j].type, oid:pobj[j].oid});

				rl.osrc.ifcProbe(ifAction).Invoke("Modify", {data:nobj, client:this});
				break;
				}
			    }
			}
		    break;

		default:
		    break;
		}
	    }
	}

    return;
    }

function osrc_apply_rel(obj, in_create)
    {
    var cnt = 0;
    while(typeof obj[cnt] != 'undefined') cnt++;

    // First, check for relationships that might imply key values
    for(var i in osrc_relationships)
	{
	var rl = osrc_relationships[i];
	if ((rl.osrc == this && rl.is_slave) || (rl.target_osrc == this && !rl.is_slave))
	    {
	    if (rl.osrc == this)
		{
		var tgt = rl.target_osrc;
		var srckey = 'key_';
		var tgtkey = 'target_key_';
		}
	    else
		{
		var tgt = rl.osrc;
		var srckey = 'target_key_';
		var tgtkey = 'key_';
		}
	    if (tgt.CurrentRecord && tgt.replica && tgt.replica[tgt.CurrentRecord])
		{
		for(var k=1;k<=5;k++)
		    {
		    if (!rl[tgtkey + k]) continue;
		    for(var j in tgt.replica[tgt.CurrentRecord])
			{
			var col = tgt.replica[tgt.CurrentRecord][j];
			if (col == null || typeof col != 'object') continue;
			if (col.oid == rl[tgtkey + k])
			    {
			    var found = false;
			    for(var l in obj)
				{
				if (obj[l] == null || typeof obj[l] != 'object') continue;
				if (obj[l].oid == rl[srckey + k])
				    {
				    found = true;
				    if (!in_create || rl[srckey + k].enforce_create)
					obj[l] = {type:col.type, value:col.value, hints:col.hints, oid:rl[srckey + k]};
				    }
				}
			    if (!found)
				obj[cnt++] = {type:col.type, value:col.value, hints:col.hints, oid:rl[srckey + k]};
			    }
			}
		    }
		}
	    }
	}

    return;
    }

/** called by child when all or part of the child is shown to the user **/
function osrc_cb_reveal(child)
    {
    if ((typeof child) == 'object' && child.eventName)
	{
	var e = child;
	switch (e.eventName) 
	    {
	    case 'Reveal':
		this.revealed_children++;
		break;
	    case 'Obscure':
		return this.Obscure(null);
		break;
	    case 'RevealCheck':
	    case 'ObscureCheck':
		pg_reveal_check_ok(e);
		break;
	    }
	}
    else
	{
	//alert(this.name + ' got Reveal');
	// Increment reveal counts
	this.revealed_children++;
	}
    if (this.revealed_children > 1) return 0;

    // User requested onReveal?  If so, do that here.
    //if (!this.bh_finished) return 0;
    if ((this.autoquery == this.AQonFirstReveal || this.autoquery == this.AQonEachReveal) && !this.init)
	pg_addsched_fn(this,'InitQuery', [], 0);
    else if (this.autoquery == this.AQonEachReveal)
	this.ifcProbe(ifAction).SchedInvoke('QueryObject', {query:null, client:null, ro:this.readonly}, 0);
    else
	this.Dispatch();

    if (this.has_onreveal_relationship && this.hidden_change_cnt > 0)
	{
	this.hidden_change_cnt = 0;
	this.Resync();
	}
    return 0;
    }

/** called by a child when all or part of the child is hidden from the user **/
function osrc_cb_obscure(child)
    {
    // Decrement reveal counts
    if (this.revealed_children > 0) this.revealed_children--;
    return 0;
    }

/** Control message handler **/
function osrc_cb_control_msg(m)
    {
    var s='';
    for(var i = 0; i<m.length;i++)
	s += m[i].target + ': ' + m[i].href + ' = ' + m[i].text + '\n';
    alert(s);
    return;
    }


function osrc_get_value(n)
    {
    var v = null;
    if (n == 'is_client_savable')
	return this.is_client_savable;
    if (n == 'cx__current_id')
	return this.CurrentRecord;
    if (this.CurrentRecord && this.replica && this.replica[this.CurrentRecord])
	{
	for(var i in this.replica[this.CurrentRecord])
	    {
	    var col = this.replica[this.CurrentRecord][i];
	    if (col.oid == n)
		{
		if (col.value == null)
		    return null;
		else if (col.type == 'integer')
		    return parseInt(col.value);
		else
		    return col.value;
		}
	    }
	}
    return v;
    }


function osrc_do_filter(r)
    {
    r.schedid = null;
    var query = [];
    query.oid=null;
    query.joinstring='AND';
    var f = r.filter_to_use;
    if (r.tw) f = f + '*';
    if (r.lw) f = '*' + f;
    if (f && r.prev_filter && f.valueOf() == r.prev_filter.valueOf()) return;
    r.prev_filter = f;
    var t={oid:r.field, value:f, type:'string'};
    query.push(t);
    this.ifcProbe(ifAction).Invoke("QueryObject", {query:query, client:this, ro:true});
    //alert('doing filter with ' + r.field + ' = ' + r.filter_to_use);
    }


function osrc_filter_changed(prop, oldv, newv)
    {
    var osrc = wgtrFindContainer(this, "widget/osrc");
    for(var i in osrc.rulelist)
	{
	var rl = osrc.rulelist[i];
	if (rl.ruletype == 'osrc_filter' && rl.widget == this)
	    {
	    if (rl.schedid)
		{
		pg_delsched(rl.schedid);
		rl.schedid = null;
		}
	    var nv = new String(newv);
	    if (nv.length >= rl.mc)
		{
		rl.schedid = pg_addsched_fn(osrc, 'osrc_do_filter', [rl], rl.qd);
		rl.filter_to_use = nv;
		}
	    }
	}
    return newv;
    }


function osrc_add_rule(rule_widget)
    {
    var rl = {ruletype:rule_widget.ruletype, widget:rule_widget};
    if (rl.ruletype == 'osrc_filter')
	{
	rl.mc = rule_widget.min_chars;
	if (rl.mc == null) rl.mc = 1;
	rl.qd = rule_widget.query_delay;
	if (rl.qd == null) rl.qd = 1000;
	rl.tw = rule_widget.trailing_wildcard;
	if (rl.tw == null) rl.tw = 1;
	rl.lw = rule_widget.leading_wildcard;
	if (rl.lw == null) rl.lw = 0;
	rl.field = rule_widget.fieldname;
	rl.prev_filter = null;
	rule_widget._osrc_filter_changed = osrc_filter_changed;
	htr_watch(rule_widget, "value", "_osrc_filter_changed");
	this.rulelist.push(rl);
	}
    else if (rl.ruletype == 'osrc_relationship')
	{
	for(var keynum = 1; keynum <= 5; keynum++)
	    {
	    rl['key_' + keynum] = rule_widget['key_' + keynum];
	    rl['target_key_' + keynum] = rule_widget['target_key_' + keynum];
	    }
	rl.osrc = this;
	rl.aq = rule_widget.autoquery;
	rl.target_osrc = wgtrGetNode(this, rule_widget.target);
	rl.is_slave = rule_widget.is_slave;
	if (rl.is_slave == null)
	    rl.is_slave = 1;
	rl.revealed_only = rule_widget.revealed_only;
	if (rl.revealed_only == null)
	    rl.revealed_only = 0;
	rl.enforce_create = rule_widget.enforce_create;
	if (rl.enforce_create == null)
	    rl.enforce_create = 1;
	osrc_relationships.push(rl);
	}
    else if (rl.ruletype == 'osrc_key')
	{
	rl.key_fieldname = rule_widget.key_fieldname;
	rl.keying_method = rule_widget.keying_method;
	switch(rl.keying_method)
	    {
	    case 'maxplusone':
		rl.min_value = rule_widget.min_value;
		rl.max_value = rule_widget.max_value;
		break;

	    case 'counter':
		rl.object_path = rule_widget.object_path;
		rl.counter_attribute = rule_widget.counter_attribute;
		break;

	    case 'counterosrc':
		rl.osrc = null;
		if (rule_widget.osrc)
		    rl.osrc = wgtrGetNode(this, rule_widget.osrc);
		if (!rl.osrc)
		    rl.osrc = wgtrFindContainer(this, "widget/osrc");
		rl.counter_attribute = rule_widget.counter_attribute;
		break;

	    case 'sql':
		rl.sql = rule_widget.sql;
		break;

	    case 'value':
		rl.value_container = rule_widget;
		break;

	    default:
		alert("Invalid keying method '" + rl.keying_method + "' for osrc_key rule");
		break;
	    }
	this.rulelist.push(rl);
	}
    }


function osrc_queue_request(r)
    {
    this.request_queue.push(r);
    }


function osrc_dispatch()
    {
    if (this.pending) return;
    var req = null;
    var requeue = [];
    while ((req = this.request_queue.shift()) != null)
	{
	switch(req.Request)
	    {
	    case 'Query':
		if (!this.qy_reveal_only || this.revealed_children > 0)
		    this.QueryHandler(req.Param);
		else
		    requeue.push(req);
		break;

	    case 'QueryObject':
		this.QueryObjectHandler(req.Param);
		break;

	    case 'MoveTo':
		this.MoveToRecordHandler(req.Param);
		break;
	    }
	if (this.pending) break;
	}
    while((req = requeue.shift())) this.request_queue.push(req);
    return;
    }


// OSRC Client routines (for linking with another osrc)
function osrc_oc_resync()
    {
    if (this.has_onreveal_relationship && this.revealed_children == 0)
	{
	this.hidden_change_cnt++;
	return;
	}
    //alert('Resync: ' + this.sql);
    if (!this.no_autoquery_on_resync)
	{
	var sync_param = {ParentOSRC:this.master_osrc};
	for(var i=1; i<=10;i++)
	    {
	    sync_param['ParentKey'+i] = this.master_keys['master_'+i];
	    sync_param['ChildKey'+i] = this.master_keys['slave_'+i];
	    }
	this.ifcProbe(ifAction).Invoke("Sync", sync_param);
	}
    }

function osrc_oc_data_available()
    {
    return;
    }

function osrc_oc_replica_moved()
    {
    this.Resync();
    return;
    }

function osrc_oc_is_discard_ready()
    {
    this.GoNogo(osrc_oc_is_discard_ready_yes, osrc_oc_is_discard_ready_no);
    return false;
    }

function osrc_oc_is_discard_ready_yes()
    {
    this.master_osrc.QueryContinue(this);
    }

function osrc_oc_is_discard_ready_no()
    {
    this.master_osrc.QueryCancel(this);
    }

function osrc_oc_object_available(o)
    {
    this.Resync();
    return;
    }

function osrc_oc_object_created(o)
    {
    this.Resync();
    return;
    }

function osrc_oc_object_modified(o)
    {
    this.Resync();
    return;
    }

function osrc_oc_object_deleted(o)
    {
    this.Resync();
    return;
    }

function osrc_oc_operation_complete(o)
    {
    return true;
    }


// Bottom Half of the initialization - after everything has had a chance
// to osrc_init()
function osrc_init_bh()
    {
    // Search for relationships... then register as an osrc client
    for(var i in osrc_relationships)
	{
	var rl = osrc_relationships[i];
	if ((rl.osrc == this && rl.is_slave) || (rl.target_osrc == this && !rl.is_slave))
	    {
	    if (rl.osrc == this)
		{
		this.master_osrc = rl.target_osrc;
		var masterkey = 'target_key_';
		var slavekey = 'key_';
		}
	    else
		{
		this.master_osrc = rl.osrc;
		var masterkey = 'key_';
		var slavekey = 'target_key_';
		}
	    this.master_osrc.Register(this);
	    //alert('Register: ' + this.sql);
	    this.master_keys = {};
	    for(var i=1;i<=10;i++)
		{
		this.master_keys['master_' + i] = rl[masterkey + i];
		this.master_keys['slave_' + i] = rl[slavekey + i];
		}
	    if (rl.revealed_only)
		this.has_onreveal_relationship = true;
	    if (typeof rl.aq != 'undefined' && !rl.aq)
		this.no_autoquery_on_resync = true;
	    //pg_addsched_fn(this, "Resync", [], 0);
	    }
	}
    this.bh_finished = true;

    // Autoquery on load?  Reveal event already occurred?
    /*if (this.autoquery == this.AQonLoad) 
	pg_addsched_fn(this,'InitQuery', [], 0);
    else if (this.revealed_children && (this.autoquery == this.AQonFirstReveal || this.autoquery == this.AQonEachReveal) && !this.init)
	pg_addsched_fn(this,'InitQuery', [], 0);*/
    }


function osrc_action_save_clients(aparam)
    {
    if (!this.is_client_savable) return;

    // Do this in two steps - save our immediate clients first, then pass the word
    // on to clients of clients.  This minimizes the chance of failures due to
    // relational integrity constraints.
    for (var c in this.child)
	{
	var cld = this.child[c];
	if (typeof cld.is_savable != 'undefined' && cld.is_savable)
	    cld.ifcProbe(ifAction).Invoke('Save', {});
	}
    for (var c in this.child)
	{
	var cld = this.child[c];
	if (typeof cld.is_client_savable != 'undefined' && cld.is_client_savable)
	    cld.ifcProbe(ifAction).Invoke('SaveClients', {});
	}
    }


function osrc_do_request(cmd, url, params, cb, target)
    {
    var first = true;
    if (!target) target = this;
    params.cx__akey = akey;
    params.ls__mode = 'osml';
    params.ls__req = cmd;
    if (this.sid) params.ls__sid = this.sid;
    if (!this.ind_act) params.cx__noact = '1';
    for(var p in params)
	{
	url += (first?'?':'&') + htutil_escape(p) + '=' + htutil_escape(params[p]);
	first = false;
	}
    this.request_start_ts = pg_timestamp();
    pg_serialized_load(target, url, cb, !this.ind_act);
    }


function osrc_print_debug()
    {
    var str = "\n";
    str += "First Record.... " + this.FirstRecord + "\n";
    str += "Last Record..... " + this.LastRecord + "\n";
    str += "Current Record.. " + this.CurrentRecord + "\n";
    str += "Target Record... [" + this.TargetRecord[0] + "," + this.TargetRecord[1] + "]\n";
    str += "OSML Record..... " + this.OSMLRecord + "\n";
    return str;
    }


function osrc_param_notify(pname, pwgt, datatype, curval)
    {
    this.params[pname] = {pname:pname, pwgt:pwgt, datatype:datatype, val:curval};
    }


function osrc_encode(pl)
    {
    var s = '';

    for(var p in pl)
	{
	var v = pl[p];
	var dt;

	if (this.type_list[p])
	    dt = this.type_list[p];
	else if (typeof v == 'number')
	    dt = 'integer';
	else
	    dt = 'string';

	if (!s)
	    s += '?';
	else
	    s += '&';
	if (v != null)
	    s += htutil_escape(p) + '=' + htutil_escape(dt) + ':V:' + htutil_escape(v);
	else
	    s += htutil_escape(p) + '=' + htutil_escape(dt) + ':N:';
	}

    return s;
    }


// Read through the current query parameters, and encode them into a string to
// be passed to the server.
function osrc_encode_params()
    {
    var s = '';
    var pl = {};
    for(var i in this.params)
	{
	var p = this.params[i];
	var v = p.pwgt.getvalue();
	if (!s)
	    s += '?';
	else
	    s += '&';
	if (v != null)
	    s += htutil_escape(p.pname) + '=' + htutil_escape(p.datatype) + ':V:' + htutil_escape(v);
	else
	    s += htutil_escape(p.pname) + '=' + htutil_escape(p.datatype) + ':N:';
	}
    return s;
    }

function osrc_destroy()
    {
    pg_set(this, "src", "about:blank");
    }


/**  OSRC Initializer **/
function osrc_init(param)
    {
    var loader = param.loader;
    ifc_init_widget(loader);
    loader.osrcname=param.name;
    loader.readahead=param.readahead;
    loader.scrollahead=param.scrollahead;
    loader.replicasize=param.replicasize;
    loader.initreplicasize = param.replicasize;
    loader.ind_act = param.ind_act;
    loader.qy_reveal_only = param.qy_reveal_only;
    loader.sql=param.sql;
    loader.filter=param.filter;
    loader.baseobj=param.baseobj;
    loader.use_having = param.use_having;
    loader.readonly = false;
    loader.autoquery = param.autoquery;
    loader.revealed_children = 0;
    loader.rulelist = [];
    loader.SyncID = osrc_syncid++;
    loader.bh_finished = false;
    loader.request_queue = [];
    loader.params = [];
    loader.destroy_widget = osrc_destroy;

    // autoquery types - must match htdrv_osrc.c's enum declaration
    loader.AQnever = 0;
    loader.AQonLoad = 1;
    loader.AQonFirstReveal = 2;
    loader.AQonEachReveal = 3;

    // Handle declarative rules
    loader.addRule = osrc_add_rule;

    loader.osrc_do_filter = osrc_do_filter;
    loader.osrc_filter_changed = osrc_filter_changed;
    loader.osrc_oldoid_cleanup = osrc_oldoid_cleanup;
    loader.osrc_oldoid_cleanup_cb = osrc_oldoid_cleanup_cb;
    loader.osrc_open_query_startat = osrc_open_query_startat;
    loader.ParseOneAttr = osrc_parse_one_attr;
    loader.ParseOneRow = osrc_parse_one_row;
    loader.NewReplicaObj = osrc_new_replica_object;
    loader.PruneReplica = osrc_prune_replica;
    loader.ClearReplica = osrc_clear_replica;
    loader.ApplyRelationships = osrc_apply_rel;
    loader.ApplyKeys = osrc_apply_keys;
    loader.EndQuery = osrc_end_query;
    loader.FoundRecord = osrc_found_record;
    loader.DoFetch = osrc_do_fetch;
    loader.FetchNext = osrc_fetch_next;
    loader.GoNogo = osrc_go_nogo;
    loader.QueueRequest = osrc_queue_request;
    loader.Dispatch = osrc_dispatch;
    loader.DoRequest = osrc_do_request;
    loader.EncodeParams = osrc_encode_params;
    loader.Encode = osrc_encode;
    loader.GiveAllCurrentRecord=osrc_give_all_current_record;
    loader.ChangeCurrentRecord=osrc_change_current_record;
    loader.MoveToRecord=osrc_move_to_record;
    loader.MoveToRecordCB=osrc_move_to_record_cb;
    loader.child =  [];
    loader.oldoids =  [];
    loader.sid = null;
    loader.qid = null;
    loader.savable_client_count = 0;
    loader.lastquery = null;
    loader.prevcurrent = null;
    loader.has_onreveal_relationship = false;
    loader.hidden_change_cnt = 0;
    loader.query_delay = 0;
    loader.type_list = [];
    loader.do_append = false;
    loader.query_ended = false;

    loader.MoveToRecordHandler = osrc_move_to_record_handler;
    loader.QueryObjectHandler = osrc_query_object_handler;
    loader.QueryHandler = osrc_query_handler;
   
    // Actions
    var ia = loader.ifcProbeAdd(ifAction);
    //loader.ActionClear=osrc_action_clear;
    ia.Add("Query", osrc_action_query);
    ia.Add("QueryObject", osrc_action_query_object);
    ia.Add("QueryParam", osrc_action_query_param);
    ia.Add("OrderObject", osrc_action_order_object);
    ia.Add("Delete", osrc_action_delete);
    ia.Add("CreateObject", osrc_action_create_object);
    ia.Add("Create", osrc_action_create);
    ia.Add("Modify", osrc_action_modify);
    ia.Add("First", osrc_move_first);
    ia.Add("Next", osrc_move_next);
    ia.Add("Prev", osrc_move_prev);
    ia.Add("Last", osrc_move_last);
    ia.Add("Sync", osrc_action_sync);
    ia.Add("DoubleSync", osrc_action_double_sync);
    ia.Add("SaveClients", osrc_action_save_clients);
    ia.Add("Refresh", osrc_action_refresh);
    ia.Add("ChangeSource", osrc_action_change_source);
    ia.Add("DoSQL", osrc_action_do_sql);
    ia.Add("FindObject", osrc_action_find_object);

    // Events
    var ie = loader.ifcProbeAdd(ifEvent);
    ie.Add("DataFocusChanged");
    ie.Add("EndQuery");
    ie.Add("Created");

    // Data Values
    var iv = loader.ifcProbeAdd(ifValue);
    iv.SetNonexistentCallback(osrc_get_value);

    loader.ParamNotify = osrc_param_notify;
    loader.CreateCB2 = osrc_action_create_cb2;
    loader.DoubleSyncCB = osrc_action_double_sync_cb;
    loader.OpenSession=osrc_open_session;
    loader.OpenQuery=osrc_open_query;
    loader.CloseQuery=osrc_close_query;
    loader.CloseObject=osrc_close_object;
    loader.CloseSession=osrc_close_session;
/**    loader.StoreReplica=osrc_store_replica; **/
    loader.QueryContinue = osrc_cb_query_continue;
    loader.QueryCancel = osrc_cb_query_cancel;
    loader.RequestObject = osrc_cb_request_object;
    loader.NewObjectTemplate = osrc_cb_new_object_template;
    loader.SetViewRange = osrc_cb_set_view_range;
    loader.InitBH = osrc_init_bh;
    loader.Register = osrc_cb_register;
    loader.Reveal = osrc_cb_reveal;
    loader.Obscure = osrc_cb_obscure;
    loader.MakeFilter = osrc_make_filter;
    loader.MakeFilterString = osrc_make_filter_string;
    loader.MakeFilterInteger = osrc_make_filter_integer;
    if (wgtrGetChildren(loader).length == 0)
	pg_reveal_register_listener(loader, true);

    loader.ScrollTo = osrc_scroll_to;
    loader.ScrollPrev = osrc_scroll_prev;
    loader.ScrollNext = osrc_scroll_next;
    loader.ScrollPrevPage = osrc_scroll_prev_page;
    loader.ScrollNextPage = osrc_scroll_next_page;

    loader.TellAllReplicaMoved = osrc_tell_all_replica_moved;

    loader.InitQuery = osrc_init_query;
    loader.cleanup = osrc_cleanup;

    // this is triggered <n> msec after a query returns data, so
    // we don't hold open locks on the server forever.
    loader.QueryTimeout = osrc_query_timeout;

    // OSRC Client interface -- for linking osrc's together
    loader.DataAvailable = osrc_oc_data_available;
    loader.ReplicaMoved = osrc_oc_replica_moved;
    loader.IsDiscardReady = osrc_oc_is_discard_ready;
    loader.ObjectAvailable = osrc_oc_object_available;
    loader.ObjectCreated = osrc_oc_object_created;
    loader.ObjectModified = osrc_oc_object_modified;
    loader.ObjectDeleted = osrc_oc_object_deleted;
    loader.OperationComplete = osrc_oc_operation_complete;

    // OSRC Client interface helpers
    loader.Resync = osrc_oc_resync;

    // Client side maintained properties
    loader.is_client_savable = false;

    // Debugging functions
    loader.print_debug = osrc_print_debug;

    // Request replication messages
    loader.request_updates = param.requestupdates?1:0;
    if (param.requestupdates) pg_msg_request(loader, pg_msg.MSG_REPMSG);
    loader.ControlMsg = osrc_cb_control_msg;

    // do sql loader
    loader.do_sql_loader = null;
    loader.osrc_action_do_sql_cb = osrc_action_do_sql_cb;

    // Zero out the replica
    loader.ClearReplica();

    if (loader.autoquery == loader.AQonLoad) 
	pg_addsched_fn(loader,'InitQuery', [], 0);

    // Finish initialization...
    pg_addsched_fn(loader, "InitBH", [], 0);

    return loader;
    }

