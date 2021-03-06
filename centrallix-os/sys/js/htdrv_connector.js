// Copyright (C) 1998-2001 LightSys Technology Services, Inc.
//
// You may use these files and this library under the terms of the
// GNU Lesser General Public License, Version 2.1, contained in the
// included file "COPYING" or http://www.gnu.org/licenses/lgpl.txt.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Lesser General Public License for more details.

function cn_activate(t,f,eparam)
    {
    if (eparam == null) eparam = {};
    if (!t) alert('null event source for cn_activate ' + f);
    if (!t.ifcProbe) alert('bad event source ' + t.id);
    if (!t.ifcProbe(ifEvent)) alert('ifEvent not defined on ' + t.id + ' for event ' + f);
    return t.ifcProbe(ifEvent).Activate(f,eparam);
    }

// would be nice if this could go through the wgtr module, but the
// sequence of events at startup makes that tricky - this gets called
// before the wgtr stuff is initialized
function cn_add(e)
    {
    if (this.LSParent['Event' + e] == null)
	this.LSParent['Event' + e] = new Array();
    this.LSParent['Event' + e][this.LSParent['Event' + e].length] = this.RunEvent;
    }

function cn_init(param)
    {
    this.Add = cn_add;
    this.type = 'cn';
    this.LSParent = param.parent;
    this.RunEvent = param.f;
    }

// Load indication
if (window.pg_scripts) pg_scripts['htdrv_connector.js'] = true;
